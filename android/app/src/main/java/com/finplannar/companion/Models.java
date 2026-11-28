package com.finplannar.companion;

/**
 * Small in-memory data holders shared by the scanner, parser, database and UI.
 * They are deliberately package-private: this app has no external API surface.
 */
final class SmsItem {
    long id;
    String sender = "";
    String body = "";
    long smsDate;
    int type;

    SmsItem() {
    }

    SmsItem(long id, String sender, String body, long smsDate, int type) {
        this.id = id;
        this.sender = sender == null ? "" : sender;
        this.body = body == null ? "" : body;
        this.smsDate = smsDate;
        this.type = type;
    }
}

final class Candidate {
    String fingerprint = "";
    String sender = "";
    String body = "";
    long smsDate;
    double amount;
    String merchant = "";
    String name = "";
    String category = "Other";
    String account = "bank";   // built-in id or a custom account id from Supabase
    String kind = "expense";   // "income" or "expense"
    String source = "parsed";  // "learned" or "parsed"
    boolean ignored;
    boolean reviewed;
    boolean synced;
    String remoteFlowId;

    Candidate() {
    }
}

final class VendorRule {
    String vendorKey = "";
    String vendorName = "";
    String kind = "expense";
    String category = "Other";
    String account = "bank";
    boolean autoApply = true;

    VendorRule() {
    }

    VendorRule(String vendorKey, String vendorName, String kind, String category,
               String account, boolean autoApply) {
        this.vendorKey = vendorKey == null ? "" : vendorKey;
        this.vendorName = vendorName == null ? "" : vendorName;
        this.kind = kind;
        this.category = category;
        this.account = account;
        this.autoApply = autoApply;
    }
}

/** A planned cash-flow row fetched from Supabase for the companion editor. */
final class CashFlowRow {
    String id = "";
    String kind = "expense";
    String name = "";
    double amount;
    String category = "Other";
    String account = "bank";
    String recurrence = "monthly";
    int intervalCount = 1;
    String startDate = "";
    String source = "manual";

    CashFlowRow() {
    }
}

/** One planned or recorded line shown in the companion's month view. */
final class MonthEvent {
    String date = "";
    String title = "";
    String detail = "";
    String kind = "expense";   // "income" or "expense"
    boolean planned;
    double amount;
    String refId = "";         // budget id or actual event_key, used for editing
    String occurrenceDate = ""; // original planned date, before any move
    String category = "Other";
    String source = "manual";

    MonthEvent(String date, String title, String detail, String kind, boolean planned, double amount) {
        this.date = date;
        this.title = title == null || title.trim().isEmpty() ? "Entry" : title.trim();
        this.detail = detail == null ? "" : detail;
        this.kind = "income".equals(kind) ? "income" : "expense";
        this.planned = planned;
        this.amount = Math.abs(amount);
    }
}
