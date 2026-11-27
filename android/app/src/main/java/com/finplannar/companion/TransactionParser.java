package com.finplannar.companion;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * All parsing happens locally. No SMS text is uploaded for classification; the only
 * network calls are the explicit inserts performed by {@link SupabaseApi} on save.
 */
final class TransactionParser {
    private static final Pattern CURRENCY_AMOUNT = Pattern.compile(
            "(?i)(?:₹|\\bINR\\b|\\bRs\\.?)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)");
    private static final Pattern VERB_AMOUNT = Pattern.compile(
            "(?i)\\b(?:debited|credited|spent|paid|sent|withdrawn|received|deposited|charged)\\b"
                    + "[^0-9]{0,24}([0-9][0-9,]*(?:\\.[0-9]{1,2})?)");
    private static final Pattern ANY_AMOUNT = Pattern.compile(
            "\\b([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)\\b");

    private static final Pattern EXPENSE_WORDS = Pattern.compile(
            "(?i)\\b(?:debited|spent|paid|sent|withdrawn|withdrawal|charged|purchase)\\b");
    private static final Pattern INCOME_WORDS = Pattern.compile(
            "(?i)\\b(?:credited|received|refund|cashback|salary|deposited)\\b");
    private static final Pattern MERCHANT = Pattern.compile(
            "(?i)\\b(?:at|from)\\s+([A-Za-z0-9][A-Za-z0-9 .&'\\-]{1,60})");
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

    /** ₹ / Rs / INR first, then verbs such as debited/credited, then any number. */
    static double parseAmount(String body) {
        if (body == null || body.isEmpty()) {
            return 0;
        }
        double amount = firstAmount(CURRENCY_AMOUNT, body);
        if (amount <= 0) {
            amount = firstAmount(VERB_AMOUNT, body);
        }
        if (amount <= 0) {
            amount = firstAmount(ANY_AMOUNT, body);
        }
        return amount;
    }

    private static double firstAmount(Pattern pattern, String body) {
        Matcher matcher = pattern.matcher(body);
        while (matcher.find()) {
            try {
                double value = Double.parseDouble(matcher.group(1).replace(",", ""));
                if (value > 0 && value < 1_000_000_000d) {
                    return value;
                }
            } catch (NumberFormatException ignored) {
                // Try the next match.
            }
        }
        return 0;
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
        String merchant = "";
        if (body != null) {
            Matcher matcher = MERCHANT.matcher(body);
            if (matcher.find()) {
                merchant = matcher.group(1);
            }
        }
        // "at SWIGGY on 12-11-2026" -> "SWIGGY".
        merchant = merchant.replaceAll("(?i)\\s+(?:on|via|for|using|with|at|from|by|dated)\\b.*$", "");
        merchant = merchant.replaceAll("^[^A-Za-z0-9]+|[^A-Za-z0-9&'.-]+$", "").trim();
        if (merchant.length() > 40) {
            merchant = merchant.substring(0, 40).trim();
        }
        return merchant.isEmpty() ? cleanSender(sender) : merchant;
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
        if (containsAny(lower, "salary", "payroll", "paycheck", "pay cheque")) {
            return "Salary";
        }
        if (containsAny(lower, "cashback", "cash back")) {
            return "Other";
        }
        if (containsAny(lower, "food", "restaurant", "swiggy", "zomato", "dining", "pizza", "cafe")) {
            return "Dining";
        }
        if (containsAny(lower, "grocery", "groceries", "supermarket", "bigbasket", "blinkit")) {
            return "Groceries";
        }
        if (containsAny(lower, "shopping", "amazon", "flipkart", "myntra", "store")) {
            return "Shopping";
        }
        if (containsAny(lower, "fuel", "petrol", "diesel", "gas station")) {
            return "Transport";
        }
        if (containsAny(lower, "bill", "electricity", "water", "internet", "broadband",
                "mobile", "recharge", "utility")) {
            return "Utilities";
        }
        if (containsAny(lower, "travel", "flight", "hotel", "train", "booking")) {
            return "Travel";
        }
        if (containsAny(lower, "transfer", "upi", "neft", "imps")) {
            return "Other";
        }
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
