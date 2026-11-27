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
            "(?i)(?:₹\\s*|\\b(?:Rs|INR)\\s*\\.?\\s*)"
                    + AMOUNT_VALUE + AMOUNT_SUFFIX);
    private static final Pattern TRANSACTION_VERB = Pattern.compile(
            "(?i)\\b(?:debited|credited|spent|paid|sent|withdrawn|received|deposited|charged)\\b");
    private static final Pattern VERB_AMOUNT = Pattern.compile(
            "(?i)\\b(?:debited|credited|spent|paid|sent|withdrawn|received|deposited|charged)\\b"
                    + "[^0-9]{0,24}" + AMOUNT_VALUE + AMOUNT_SUFFIX);
    private static final Pattern ANY_AMOUNT = Pattern.compile(
            "\\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)"
                    + AMOUNT_SUFFIX);

    private static final Pattern EXPENSE_WORDS = Pattern.compile(
            "(?i)\\b(?:debited|spent|paid|sent|withdrawn|withdrawal|charged|purchase)\\b");
    private static final Pattern INCOME_WORDS = Pattern.compile(
            "(?i)\\b(?:credited|received|refund|cashback|salary|deposited)\\b");
    private static final Pattern MERCHANT = Pattern.compile(
            "(?i)\\b(?:at|to|from|for)\\s+([A-Za-z0-9][A-Za-z0-9 .&'\\-]{1,60})");
    private static final Pattern MERCHANT_STOP = Pattern.compile(
            "(?i)\\s+(?:on|via|using|with|by|dated|ref(?:erence)?|txn|transaction|"
                    + "balance|available|avl|bal|for|a/c|acct|account)\\b.*$");
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
        candidate.ignored = false;
        candidate.synced = false;
        candidate.remoteFlowId = null;

        VendorRule rule = db.getVendorRule(vendorKey(candidate.sender, candidate.merchant));
        if (rule != null) {
            candidate.kind = "income".equals(rule.kind) ? "income" : "expense";
            candidate.category = rule.category.isEmpty() ? candidate.category : rule.category;
            candidate.account = "cash".equals(rule.account) ? "cash" : "bank";
            candidate.name = rule.vendorName.isEmpty() ? candidate.name : rule.vendorName;
            candidate.source = "learned";
        }
        return candidate;
    }

    /**
     * Currency-prefixed amounts are authoritative. With several (for example a balance
     * after the debit), the one closest to a transaction verb wins. Verbs and then any
     * number are only fallbacks for messages without a currency prefix.
     */
    static double parseAmount(String body) {
        if (body == null || body.isEmpty()) {
            return 0;
        }
        double amount = currencyAmount(body);
        if (amount <= 0) {
            amount = firstAmount(VERB_AMOUNT, body);
        }
        if (amount <= 0) {
            amount = firstAmount(ANY_AMOUNT, body);
        }
        return amount;
    }

    private static double currencyAmount(String body) {
        Matcher matcher = CURRENCY_AMOUNT.matcher(body);
        double best = 0;
        int bestDistance = Integer.MAX_VALUE;
        while (matcher.find()) {
            double value = toAmount(matcher.group(1));
            if (value <= 0) {
                continue;
            }
            int distance = distanceToVerb(body, matcher.start());
            if (distance < bestDistance) {
                bestDistance = distance;
                best = value;
            }
        }
        return best;
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

    private static double firstAmount(Pattern pattern, String body) {
        Matcher matcher = pattern.matcher(body);
        while (matcher.find()) {
            double value = toAmount(matcher.group(1));
            if (value > 0) {
                return value;
            }
        }
        return 0;
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
            Matcher matcher = MERCHANT.matcher(body);
            while (matcher.find()) {
                String merchant = cleanMerchant(matcher.group(1));
                if (usableMerchant(merchant)) {
                    return merchant;
                }
            }
        }
        return cleanSender(sender);
    }

    private static String cleanMerchant(String raw) {
        Matcher stop = MERCHANT_STOP.matcher(raw);
        String value = stop.find() ? raw.substring(0, stop.start()) : raw;
        // "VPA merchant@okhdfcbank" -> "merchant".
        int at = value.indexOf('@');
        if (at > 0) {
            value = value.substring(0, at);
        }
        value = value.replaceFirst("(?i)^(?:vpa|upi|card)\\s+", "").trim();
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
            if (lower.contains("interest")) return "Interest";
            if (lower.contains("dividend")) return "Dividends";
            if (containsAny(lower, "gift", "cashback", "cash back", "refund")) return "Gifts";
            return "Other";
        }
        if (containsAny(lower, "subscription", "renewal", "membership", "netflix", "spotify",
                "prime video")) return "Subscriptions";
        if (containsAny(lower, "rent", "maintenance", "society charge")) return "Housing";
        if (containsAny(lower, "bill", "electricity", "water", "internet", "broadband",
                "mobile", "recharge", "utility")) return "Utilities";
        if (containsAny(lower, "grocery", "groceries", "supermarket", "bigbasket", "blinkit")) {
            return "Groceries";
        }
        if (containsAny(lower, "food", "restaurant", "swiggy", "zomato", "dining", "pizza",
                "cafe")) return "Dining";
        if (containsAny(lower, "shopping", "amazon", "flipkart", "myntra", "store")) return "Shopping";
        if (containsAny(lower, "fuel", "petrol", "diesel", "gas station")) return "Transport";
        if (containsAny(lower, "insurance", "premium", "policy")) return "Insurance";
        if (containsAny(lower, "pharmacy", "medicine", "hospital", "doctor", "clinic",
                "apollo", "netmeds", "1mg")) return "Health";
        if (containsAny(lower, "school", "college", "tuition", "course", "udemy")) return "Education";
        if (containsAny(lower, "movie", "bookmyshow", "game", "steam")) return "Entertainment";
        if (containsAny(lower, "gym", "fitness", "salon", "spa")) return "Lifestyle";
        if (containsAny(lower, "hobby", "hobbies", "craft")) return "Hobbies";
        if (containsAny(lower, "mutual fund", "sip", "shares", "stock", "nps", "ppf",
                "investment")) return "Investments";
        if (containsAny(lower, "travel", "flight", "hotel", "train", "booking")) return "Travel";
        if (containsAny(lower, "transfer", "upi", "neft", "imps")) return "Other";
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
