package com.finplannar.companion;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * All parsing happens locally. No SMS text is uploaded for classification; the only
 * network calls are the explicit inserts performed by {@link SupabaseApi} on save.
 */
final class TransactionParser {
    private static final String AMOUNT_VALUE = "([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
    private static final String AMOUNT_SUFFIX = "\\s*(?:/-)?";
    private static final Pattern CURRENCY_AMOUNT = Pattern.compile(
            "(?i)(?:₹\\s*|\\b(?:Rs|INR)\\s*\\.?\\s*)" + AMOUNT_VALUE + AMOUNT_SUFFIX);
    private static final Pattern BALANCE_CONTEXT = Pattern.compile(
            "(?i)(?:\\b(?:new|avl|available|current|fund|securities|closing|opening)\\s+)?"
                    + "\\b(?:bal|balance|lmt|limit)\\s*:?\\s*$");
    private static final Pattern TRANSACTION_VERB = Pattern.compile(
            "(?i)\\b(?:debited|debit|credited|spent|paid|sent|withdrawn|received|deposited|"
                    + "charged|purchase|autopay)\\b");

    /** A message must look like a completed money movement before we offer it for review. */
    private static final Pattern TRANSACTION_SIGNAL = Pattern.compile(
            "(?i)\\b(?:debited|debit|credited|spent|paid|withdrawn|withdrawal|received|"
                    + "deposited|charged|purchase|autopay|emi)\\b|\\bpayment\\s+of\\b|\\breceipt\\s+of\\b");
    private static final Pattern NON_TRANSACTION = Pattern.compile(
            "(?i)(?:will\\s+be\\s+(?:debited|credited)|declined|e-?statement|"
                    + "statement\\s+(?:is\\s+)?(?:generated|sent|ready)|total\\s+due|"
                    + "min(?:imum)?\\s+due|due\\s+on|due\\s+date|bill\\s+due|"
                    + "one-?time\\s+password|\\botp\\b|password\\s+will\\s+expire|"
                    + "policy\\s+expir|estimated\\s+bill|bonus\\s+points|discount\\s+coupon|"
                    + "\\bexam\\b|\\bmarks\\b|ward\\s+is\\s+absent|missed\\s+call|"
                    + "scheduled\\s+maintenance|network\\s+maintenance|important\\s+update|"
                    + "loan\\s+facility|e-?voting|feedback|appointment|booking\\s+refr|"
                    + "application\\s+number|driving\\s+licence|driving\\s+test|ckycrr|"
                    + "fund\\s+bal|securities\\s+bal|ignore\\s+if\\s+renewed|"
                    + "track\\s+live|claimed\\s+baggage|\\bview\\s*:|\\bvisit\\s+https)");

    private static final Pattern EXPENSE_WORDS = Pattern.compile(
            "(?i)\\b(?:debited|debit|spent|paid|sent|withdrawn|withdrawal|charged|purchase|autopay)\\b");
    private static final Pattern INCOME_WORDS = Pattern.compile(
            "(?i)\\b(?:credited|received|refund|cashback|salary|deposited)\\b");
    /** "Payment of X towards/for ..." is money going out, even if a bank says "received". */
    private static final Pattern PAYMENT_FOR = Pattern.compile(
            "(?i)(?:payment of|receipt of)[^.]{0,80}?(?:towards|for your|credit card|mobile|"
                    + "bill|fibernet|subscription)");

    private static final Pattern UPI_MERCHANT = Pattern.compile(
            "(?i)\\b(?:UPI|IMPS|NEFT|RTGS)/(?:P2M|P2A|[A-Z]{2,6})/[0-9]+/([^?]{1,80})");
    private static final Pattern REF_MERCHANT = Pattern.compile(
            "(?i)\\bNBSM/[0-9]+/([^?]{1,60})|\\bMOB/TPFT/([A-Za-z][^0-9?]{1,40})");
    private static final Pattern TOWARDS_MERCHANT = Pattern.compile(
            "(?i)\\btowards\\s+(?:your\\s+)?([A-Za-z][A-Za-z0-9 .&'\\-]{1,60})");
    private static final Pattern CREDITED_NAME = Pattern.compile(
            "(?i);\\s*([A-Za-z][A-Za-z0-9 .&'\\-]{1,50})\\s+credited\\b");
    private static final Pattern MERCHANT = Pattern.compile(
            "(?i)\\b(?:at|to|from|for)\\s+([A-Za-z0-9][A-Za-z0-9 .&'\\-]{1,60})");
    private static final Pattern ON_MERCHANT = Pattern.compile(
            "(?i)\\bon\\s+([A-Z][A-Z0-9][A-Z0-9 .&'\\-]{1,50}?)\\s*(?:\\.|,|Avl|$)");
    private static final Pattern MERCHANT_STOP = Pattern.compile(
            "(?i)\\s+(?:on|via|using|with|by|dated|ref(?:erence)?|txn|transaction|balance|"
                    + "available|avl|bal|for|a/c|acct|account|not\\s+you|sms\\s+block|cust\\s+id|"
                    + "whatsapp\\s+bal|to\\s+download|to\\s+dispute|for\\s+queries)\\b.*$");
    private static final Pattern ACCOUNTISH = Pattern.compile(
            "(?i)^(?:a/c|acct|account|vpa|upi|card|xx[0-9]*|x{2,}[0-9]*)(?:\\s|$)");
    private static final Pattern CASH_WORDS = Pattern.compile(
            "(?i)\\b(?:cash|atm|withdrawal|withdrawn)\\b");

    private final CompanionDb db;

    TransactionParser(CompanionDb db) {
        this.db = db;
    }

    Candidate parse(SmsItem item) {
        Candidate candidate = new Candidate();
        candidate.fingerprint = SmsScanner.fingerprint(item);
        candidate.sender = item.sender;
        candidate.body = item.body;
        candidate.smsDate = item.smsDate;
        candidate.amount = parseAmount(item.body);
        candidate.merchant = extractMerchant(item.body, item.sender);
        candidate.kind = detectKind(item.body);
        candidate.category = inferCategory(item.body, candidate.kind);
        candidate.account = detectAccount(item.body);
        candidate.name = defaultName(candidate.merchant, candidate.kind);
        candidate.source = "parsed";
        candidate.ignored = !isTransaction(item.body);
        candidate.reviewed = candidate.ignored;
        candidate.synced = false;
        candidate.remoteFlowId = null;

        if (!candidate.ignored) {
            VendorRule rule = db.getVendorRule(vendorKey(candidate.sender, candidate.merchant));
            if (rule != null) {
                candidate.kind = "income".equals(rule.kind) ? "income" : "expense";
                candidate.category = rule.category.isEmpty() ? candidate.category : rule.category;
                candidate.account = "cash".equals(rule.account) ? "cash" : "bank";
                candidate.name = rule.vendorName.isEmpty() ? candidate.name : rule.vendorName;
                candidate.source = "learned";
            }
        }
        return candidate;
    }

    /** Non-transaction SMS is auto-ignored so dates and reference numbers never become amounts. */
    static boolean isTransaction(String body) {
        if (body == null || body.isEmpty()) {
            return false;
        }
        if (NON_TRANSACTION.matcher(body).find() || !TRANSACTION_SIGNAL.matcher(body).find()) {
            return false;
        }
        return parseAmount(body) > 0;
    }

    /**
     * Currency-prefixed amounts are authoritative. Balance/limit amounts are excluded; when
     * several real amounts remain, the one nearest a transaction verb wins. There is no
     * plain-number fallback: it turned dates and IDs into fake expenses.
     */
    static double parseAmount(String body) {
        if (body == null || body.isEmpty()) {
            return 0;
        }
        Matcher matcher = CURRENCY_AMOUNT.matcher(body);
        double best = 0;
        int bestDistance = Integer.MAX_VALUE;
        while (matcher.find()) {
            double value = toAmount(matcher.group(1));
            if (value <= 0 || isBalance(body, matcher.start())) {
                continue;
            }
            int distance = distanceToVerb(body, matcher.start());
            if (best == 0 || distance < bestDistance) {
                bestDistance = distance;
                best = value;
            }
        }
        return best;
    }

    private static boolean isBalance(String body, int position) {
        int from = Math.max(0, position - 40);
        return BALANCE_CONTEXT.matcher(body.substring(from, position)).find();
    }

    private static int distanceToVerb(String body, int position) {
        Matcher matcher = TRANSACTION_VERB.matcher(body);
        int best = Integer.MAX_VALUE;
        while (matcher.find()) {
            int distance = Math.abs(matcher.start() - position);
            if (distance < best) {
                best = distance;
            }
        }
        return best;
    }

    private static double toAmount(String raw) {
        try {
            double value = Double.parseDouble(raw.replace(",", ""));
            return value > 0 && value < 1_000_000_000d ? value : 0;
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    /** Income keywords win only when they appear earlier than expense keywords. */
    static String detectKind(String body) {
        if (body == null || body.isEmpty()) {
            return "expense";
        }
        if (PAYMENT_FOR.matcher(body).find()) {
            return "expense";
        }
        int incomeAt = firstMatch(INCOME_WORDS, body);
        int expenseAt = firstMatch(EXPENSE_WORDS, body);
        return incomeAt < expenseAt ? "income" : "expense";
    }

    private static int firstMatch(Pattern pattern, String body) {
        Matcher matcher = pattern.matcher(body);
        return matcher.find() ? matcher.start() : Integer.MAX_VALUE;
    }

    static String extractMerchant(String body, String sender) {
        if (body != null) {
            String fromUpi = firstGroup(UPI_MERCHANT, body, 1);
            if (!fromUpi.isEmpty()) {
                return fromUpi;
            }
            String fromRef = firstGroup(REF_MERCHANT, body, 1);
            if (fromRef.isEmpty()) {
                fromRef = firstGroup(REF_MERCHANT, body, 2);
            }
            if (!fromRef.isEmpty()) {
                return fromRef;
            }
            String towards = firstGroup(TOWARDS_MERCHANT, body, 1);
            if (!towards.isEmpty()) {
                return towards;
            }
            String creditedName = firstGroup(CREDITED_NAME, body, 1);
            if (!creditedName.isEmpty()) {
                return creditedName;
            }
            Matcher matcher = MERCHANT.matcher(body);
            while (matcher.find()) {
                String merchant = cleanMerchant(matcher.group(1));
                if (usableMerchant(merchant)) {
                    return merchant;
                }
            }
            String onName = firstGroup(ON_MERCHANT, body, 1);
            if (!onName.isEmpty()) {
                return onName;
            }
        }
        return cleanSender(sender);
    }

    private static String firstGroup(Pattern pattern, String body, int group) {
        Matcher matcher = pattern.matcher(body);
        if (matcher.find()) {
            String raw = matcher.group(group);
            if (raw == null) {
                return "";
            }
            String value = cleanMerchant(raw);
            if (usableMerchant(value)) {
                return value;
            }
        }
        return "";
    }

    private static String cleanMerchant(String raw) {
        Matcher stop = MERCHANT_STOP.matcher(raw);
        String value = stop.find() ? raw.substring(0, stop.start()) : raw;
        // "VPA merchant@okhdfcbank" -> "merchant"; "name/UTIB/..." -> "name".
        int at = value.indexOf('@');
        if (at > 0) {
            value = value.substring(0, at);
        }
        int slash = value.indexOf('/');
        if (slash > 0) {
            value = value.substring(0, slash);
        }
        value = value.replaceFirst("(?i)^(?:vpa|upi|card|your|the|a)\\s+", "").trim();
        value = value.replaceAll("^[^A-Za-z0-9]+|[^A-Za-z0-9&'.-]+$", "").trim();
        value = value.replaceAll("\\.+$", "").trim();
        return value.length() > 40 ? value.substring(0, 40).trim() : value;
    }

    private static boolean usableMerchant(String value) {
        if (value.length() < 3 || ACCOUNTISH.matcher(value).find()) {
            return false;
        }
        String lower = value.toLowerCase(Locale.ROOT);
        return !lower.equals("upi") && !lower.equals("atm") && !lower.equals("bank")
                && !lower.matches("hdfc|icici|sbi|axis|kotak|yes");
    }

    private static String cleanSender(String sender) {
        if (sender == null) {
            return "";
        }
        String cleaned = sender.trim();
        // Common Indian bank senders look like "XX-MERCHANT-S" or "XX-MERCHANT".
        cleaned = cleaned.replaceFirst("^[A-Za-z]{2,4}-", "");
        cleaned = cleaned.replaceFirst("-[A-Za-z]$", "");
        return cleaned.trim();
    }

    static String inferCategory(String body, String kind) {
        String lower = body == null ? "" : body.toLowerCase(Locale.ROOT);
        if ("income".equals(kind)) {
            if (containsAny(lower, "salary", "payroll", "paycheck", "pay cheque")) return "Salary";
            if (containsAny(lower, "freelance", "consulting", "invoice payment")) return "Freelance";
            if (containsAny(lower, "business", "sales proceeds")) return "Business";
            if (containsAny(lower, "rent received", "rental income")) return "Rent Received";
            if (containsWord(lower, "interest")) return "Interest";
            if (containsWord(lower, "dividend")) return "Dividends";
            if (containsAny(lower, "gift", "cashback", "cash back", "refund")) return "Gifts";
            return "Other";
        }
        if (containsAny(lower, "subscription", "renewal", "membership", "netflix", "spotify",
                "prime video", "cursor", "google", "ad free")) return "Subscriptions";
        if (containsWord(lower, "rent") || containsAny(lower, "society charge",
                "maintenance charge")) return "Housing";
        if (containsAny(lower, "fibernet", "electricity", "broadband", "utility")
                || containsWord(lower, "bill", "mobile", "recharge", "water", "internet")) {
            return "Utilities";
        }
        if (containsAny(lower, "grocery", "groceries", "supermarket", "bigbasket", "blinkit",
                "blinkmerce", "meal wallet", "zepto", "dmart", "provision", "mutton")) {
            return "Groceries";
        }
        if (containsAny(lower, "food", "restaurant", "swiggy", "zomato", "dining", "pizza",
                "cafe", "bakery", "sweets", "coffee")) return "Dining";
        if (containsAny(lower, "shopping", "amazon", "flipkart", "myntra", "store")) return "Shopping";
        if (containsAny(lower, "fuel", "petrol", "diesel", "fastag", "gas station")) return "Transport";
        if (containsAny(lower, "insurance", "lic premium") || containsWord(lower, "premium", "policy")) {
            return "Insurance";
        }
        if (containsAny(lower, "pharmacy", "medicine", "hospital", "doctor", "clinic", "apollo",
                "netmeds", "1mg", "lifecaremedical", "tataonemg", "healthcare")) return "Health";
        if (containsAny(lower, "school", "college", "tuition", "course", "udemy")) return "Education";
        if (containsAny(lower, "movie", "bookmyshow", "game", "steam")) return "Entertainment";
        if (containsAny(lower, "gym", "fitness", "salon", "spa")) return "Lifestyle";
        if (containsAny(lower, "hobby", "hobbies", "craft")) return "Hobbies";
        if (containsAny(lower, "mutual fund", "shares", "stock", "investment")
                || containsWord(lower, "sip", "nps", "ppf")) return "Investments";
        if (containsAny(lower, "travel", "flight", "hotel", "train", "booking")) return "Travel";
        return "Other";
    }

    private static boolean containsAny(String lowerBody, String... words) {
        for (String word : words) {
            if (lowerBody.contains(word)) {
                return true;
            }
        }
        return false;
    }

    /** Word boundaries avoid collisions such as "rent" inside "current". */
    private static boolean containsWord(String lowerBody, String... words) {
        for (String word : words) {
            if (Pattern.compile("\\b" + Pattern.quote(word) + "\\b").matcher(lowerBody).find()) {
                return true;
            }
        }
        return false;
    }

    static String detectAccount(String body) {
        return body != null && CASH_WORDS.matcher(body).find() ? "cash" : "bank";
    }

    static String normalized(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    /** Matches the remote vendor_rules unique key: user_id + vendor_key. */
    static String vendorKey(String sender, String merchant) {
        return normalized(sender) + "|" + normalized(merchant);
    }

    private static String defaultName(String merchant, String kind) {
        if (!merchant.isEmpty()) {
            return merchant;
        }
        return "income".equals(kind) ? "SMS income" : "SMS expense";
    }
}
