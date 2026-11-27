package com.finplannar.companion;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/**
 * Local, on-device state: scan cursor, parsed SMS candidates and learned vendor rules.
 * No SMS text or transaction detail leaves the device until the user confirms and saves.
 */
final class CompanionDb extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "finplannar_companion";
    private static final int DATABASE_VERSION = 3;

    private static final String TABLE_SCAN_STATE = "scan_state";
    private static final String TABLE_VENDOR_RULES = "vendor_rules";
    private static final String TABLE_SMS_EVENTS = "sms_events";

    private static final String COL_KEY = "key";
    private static final String COL_VALUE = "value";

    private static final String COL_VENDOR_KEY = "vendor_key";
    private static final String COL_VENDOR_NAME = "vendor_name";
    private static final String COL_KIND = "kind";
    private static final String COL_CATEGORY = "category";
    private static final String COL_ACCOUNT = "account";
    private static final String COL_AUTO_APPLY = "auto_apply";

    private static final String COL_FINGERPRINT = "fingerprint";
    private static final String COL_SENDER = "sender";
    private static final String COL_BODY = "body";
    private static final String COL_SMS_DATE = "sms_date";
    private static final String COL_AMOUNT = "amount";
    private static final String COL_MERCHANT = "merchant";
    private static final String COL_NAME = "name";
    private static final String COL_SOURCE = "source";
    private static final String COL_IGNORED = "ignored";
    private static final String COL_REVIEWED = "reviewed";
    private static final String COL_SYNCED = "synced";
    private static final String COL_REMOTE_FLOW_ID = "remote_flow_id";

    private static final String LAST_SCAN_KEY = "last_scan_at";
    private static final String LAST_SCAN_ID_KEY = "last_scan_id";

    CompanionDb(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE_SCAN_STATE + " ("
                + COL_KEY + " TEXT PRIMARY KEY, "
                + COL_VALUE + " INTEGER NOT NULL)");

        db.execSQL("CREATE TABLE " + TABLE_VENDOR_RULES + " ("
                + COL_VENDOR_KEY + " TEXT PRIMARY KEY, "
                + COL_VENDOR_NAME + " TEXT NOT NULL, "
                + COL_KIND + " TEXT NOT NULL, "
                + COL_CATEGORY + " TEXT NOT NULL, "
                + COL_ACCOUNT + " TEXT NOT NULL, "
                + COL_AUTO_APPLY + " INTEGER NOT NULL DEFAULT 1)");

        db.execSQL("CREATE TABLE " + TABLE_SMS_EVENTS + " ("
                + COL_FINGERPRINT + " TEXT PRIMARY KEY, "
                + COL_SENDER + " TEXT, "
                + COL_BODY + " TEXT, "
                + COL_SMS_DATE + " INTEGER, "
                + COL_AMOUNT + " REAL, "
                + COL_MERCHANT + " TEXT, "
                + COL_NAME + " TEXT, "
                + COL_CATEGORY + " TEXT, "
                + COL_ACCOUNT + " TEXT, "
                + COL_KIND + " TEXT, "
                + COL_SOURCE + " TEXT, "
                + COL_IGNORED + " INTEGER DEFAULT 0, "
                + COL_REVIEWED + " INTEGER DEFAULT 0, "
                + COL_SYNCED + " INTEGER DEFAULT 0, "
                + COL_REMOTE_FLOW_ID + " TEXT)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Keep learned vendor rules and the scan cursor when adding the review flag.
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE " + TABLE_SMS_EVENTS + " ADD COLUMN "
                    + COL_REVIEWED + " INTEGER DEFAULT 0");
        }
        if (oldVersion < 3) {
            // The parser changed substantially. Re-scan so old guesses do not survive.
            // Learned vendor rules are intentionally preserved.
            db.execSQL("DELETE FROM " + TABLE_SMS_EVENTS);
            db.execSQL("DELETE FROM " + TABLE_SCAN_STATE);
        }
    }

    // ---------------------------------------------------------------- scan state

    long getLastScanAt() {
        return readScanState(LAST_SCAN_KEY);
    }

    void setLastScanAt(long timestampMillis) {
        writeScanState(LAST_SCAN_KEY, timestampMillis);
    }

    /** SMS provider id cursor. More reliable than a timestamp when many texts share a second. */
    long getLastScanId() {
        return readScanState(LAST_SCAN_ID_KEY);
    }

    void setLastScanId(long smsId) {
        writeScanState(LAST_SCAN_ID_KEY, smsId);
    }

    private long readScanState(String key) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query(TABLE_SCAN_STATE, new String[]{COL_VALUE},
                COL_KEY + " = ?", new String[]{key}, null, null, null);
        try {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0L;
        } finally {
            cursor.close();
        }
    }

    private void writeScanState(String key, long value) {
        ContentValues values = new ContentValues();
        values.put(COL_KEY, key);
        values.put(COL_VALUE, value);
        getWritableDatabase().insertWithOnConflict(TABLE_SCAN_STATE, null, values,
                SQLiteDatabase.CONFLICT_REPLACE);
    }

    // ------------------------------------------------------------- SMS candidates

    boolean hasFingerprint(String fingerprint) {
        if (fingerprint == null || fingerprint.isEmpty()) {
            return false;
        }
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query(TABLE_SMS_EVENTS, new String[]{COL_FINGERPRINT},
                COL_FINGERPRINT + " = ?", new String[]{fingerprint}, null, null, null);
        try {
            return cursor.moveToFirst();
        } finally {
            cursor.close();
        }
    }

    boolean insertCandidate(Candidate candidate) {
        ContentValues values = new ContentValues();
        values.put(COL_FINGERPRINT, candidate.fingerprint);
        values.put(COL_SENDER, candidate.sender);
        values.put(COL_BODY, candidate.body);
        values.put(COL_SMS_DATE, candidate.smsDate);
        values.put(COL_AMOUNT, candidate.amount);
        values.put(COL_MERCHANT, candidate.merchant);
        values.put(COL_NAME, candidate.name);
        values.put(COL_CATEGORY, candidate.category);
        values.put(COL_ACCOUNT, candidate.account);
        values.put(COL_KIND, candidate.kind);
        values.put(COL_SOURCE, candidate.source);
        values.put(COL_IGNORED, candidate.ignored ? 1 : 0);
        values.put(COL_REVIEWED, candidate.reviewed ? 1 : 0);
        values.put(COL_SYNCED, candidate.synced ? 1 : 0);
        if (candidate.remoteFlowId == null) {
            values.putNull(COL_REMOTE_FLOW_ID);
        } else {
            values.put(COL_REMOTE_FLOW_ID, candidate.remoteFlowId);
        }
        long row = getWritableDatabase().insertWithOnConflict(TABLE_SMS_EVENTS, null, values,
                SQLiteDatabase.CONFLICT_IGNORE);
        return row != -1;
    }

    /** Persists the user's editable choices plus the Expense / Income decision. */
    void updateCandidateChoice(String fingerprint, double amount, String name, String category,
                               String account, String kind) {
        ContentValues values = new ContentValues();
        values.put(COL_AMOUNT, Math.abs(amount));
        values.put(COL_NAME, safeText(name, "SMS import"));
        values.put(COL_CATEGORY, safeText(category, "Other"));
        values.put(COL_ACCOUNT, "cash".equals(account) ? "cash" : "bank");
        values.put(COL_KIND, "income".equals(kind) ? "income" : "expense");
        values.put(COL_IGNORED, 0);
        values.put(COL_REVIEWED, 1);
        getWritableDatabase().update(TABLE_SMS_EVENTS, values,
                COL_FINGERPRINT + " = ?", new String[]{fingerprint});
    }

    void markIgnored(String fingerprint) {
        ContentValues values = new ContentValues();
        values.put(COL_IGNORED, 1);
        values.put(COL_REVIEWED, 1);
        getWritableDatabase().update(TABLE_SMS_EVENTS, values,
                COL_FINGERPRINT + " = ?", new String[]{fingerprint});
    }

    void markSynced(String fingerprint) {
        ContentValues values = new ContentValues();
        values.put(COL_SYNCED, 1);
        getWritableDatabase().update(TABLE_SMS_EVENTS, values,
                COL_FINGERPRINT + " = ?", new String[]{fingerprint});
    }

    void setRemoteFlowId(String fingerprint, String remoteFlowId) {
        ContentValues values = new ContentValues();
        values.put(COL_REMOTE_FLOW_ID, remoteFlowId);
        getWritableDatabase().update(TABLE_SMS_EVENTS, values,
                COL_FINGERPRINT + " = ?", new String[]{fingerprint});
    }

    /** Rows still waiting for an Expense / Income / Ignore choice. */
    List<Candidate> pendingCandidates(long sinceMillis, int limit) {
        return candidatesWhere(COL_SYNCED + " = 0 AND " + COL_REVIEWED + " = 0 AND "
                + COL_SMS_DATE + " >= ?", sinceMillis, limit);
    }

    /** Chosen rows waiting for Save selected. Ignored rows are included. */
    List<Candidate> reviewedCandidates(long sinceMillis) {
        return candidatesWhere(COL_SYNCED + " = 0 AND " + COL_REVIEWED + " = 1 AND "
                + COL_SMS_DATE + " >= ?", sinceMillis, 0);
    }

    int countPending(long sinceMillis) {
        return countWhere(COL_SYNCED + " = 0 AND " + COL_REVIEWED + " = 0 AND "
                + COL_SMS_DATE + " >= ?", new String[]{String.valueOf(sinceMillis)});
    }

    int countReadyToSave(long sinceMillis) {
        return countWhere(COL_SYNCED + " = 0 AND " + COL_REVIEWED + " = 1 AND "
                + COL_SMS_DATE + " >= ?", new String[]{String.valueOf(sinceMillis)});
    }

    private List<Candidate> candidatesWhere(String where, long sinceMillis, int limit) {
        SQLiteDatabase db = getReadableDatabase();
        String limitValue = limit > 0 ? String.valueOf(limit) : null;
        Cursor cursor = db.query(TABLE_SMS_EVENTS, null, where,
                new String[]{String.valueOf(sinceMillis)}, null, null,
                COL_SMS_DATE + " ASC", limitValue);
        List<Candidate> result = new ArrayList<>();
        try {
            while (cursor.moveToNext()) {
                result.add(candidateFromCursor(cursor));
            }
        } finally {
            cursor.close();
        }
        return result;
    }

    int countSynced() {
        return countWhere(COL_SYNCED + " = 1");
    }

    int countIgnored() {
        return countWhere(COL_IGNORED + " = 1");
    }

    private int countWhere(String where) {
        return countWhere(where, null);
    }

    private int countWhere(String where, String[] args) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query(TABLE_SMS_EVENTS, new String[]{COL_FINGERPRINT}, where,
                args, null, null, null);
        try {
            return cursor.getCount();
        } finally {
            cursor.close();
        }
    }

    private static Candidate candidateFromCursor(Cursor cursor) {
        Candidate candidate = new Candidate();
        candidate.fingerprint = text(cursor, COL_FINGERPRINT);
        candidate.sender = text(cursor, COL_SENDER);
        candidate.body = text(cursor, COL_BODY);
        candidate.smsDate = cursor.getLong(cursor.getColumnIndexOrThrow(COL_SMS_DATE));
        candidate.amount = cursor.getDouble(cursor.getColumnIndexOrThrow(COL_AMOUNT));
        candidate.merchant = text(cursor, COL_MERCHANT);
        candidate.name = text(cursor, COL_NAME);
        candidate.category = text(cursor, COL_CATEGORY);
        candidate.account = text(cursor, COL_ACCOUNT);
        candidate.kind = text(cursor, COL_KIND);
        candidate.source = text(cursor, COL_SOURCE);
        candidate.ignored = cursor.getInt(cursor.getColumnIndexOrThrow(COL_IGNORED)) != 0;
        candidate.reviewed = cursor.getInt(cursor.getColumnIndexOrThrow(COL_REVIEWED)) != 0;
        candidate.synced = cursor.getInt(cursor.getColumnIndexOrThrow(COL_SYNCED)) != 0;
        candidate.remoteFlowId = text(cursor, COL_REMOTE_FLOW_ID);
        return candidate;
    }

    // ------------------------------------------------------------- vendor rules

    VendorRule getVendorRule(String vendorKey) {
        if (vendorKey == null || vendorKey.isEmpty()) {
            return null;
        }
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query(TABLE_VENDOR_RULES, null, COL_VENDOR_KEY + " = ?",
                new String[]{vendorKey}, null, null, null);
        try {
            return cursor.moveToFirst() ? ruleFromCursor(cursor) : null;
        } finally {
            cursor.close();
        }
    }

    boolean upsertVendorRule(VendorRule rule) {
        if (rule == null || rule.vendorKey.isEmpty()) {
            return false;
        }
        ContentValues values = new ContentValues();
        values.put(COL_VENDOR_KEY, rule.vendorKey);
        values.put(COL_VENDOR_NAME, rule.vendorName);
        values.put(COL_KIND, rule.kind);
        values.put(COL_CATEGORY, rule.category);
        values.put(COL_ACCOUNT, rule.account);
        values.put(COL_AUTO_APPLY, rule.autoApply ? 1 : 0);
        long row = getWritableDatabase().insertWithOnConflict(TABLE_VENDOR_RULES, null, values,
                SQLiteDatabase.CONFLICT_REPLACE);
        return row != -1;
    }

    List<VendorRule> allVendorRules() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.query(TABLE_VENDOR_RULES, null, null, null, null, null,
                COL_VENDOR_KEY + " ASC");
        List<VendorRule> result = new ArrayList<>();
        try {
            while (cursor.moveToNext()) {
                result.add(ruleFromCursor(cursor));
            }
        } finally {
            cursor.close();
        }
        return result;
    }

    int deleteVendorRule(String vendorKey) {
        return getWritableDatabase().delete(TABLE_VENDOR_RULES, COL_VENDOR_KEY + " = ?",
                new String[]{vendorKey});
    }

    private static VendorRule ruleFromCursor(Cursor cursor) {
        return new VendorRule(
                text(cursor, COL_VENDOR_KEY),
                text(cursor, COL_VENDOR_NAME),
                text(cursor, COL_KIND),
                text(cursor, COL_CATEGORY),
                text(cursor, COL_ACCOUNT),
                cursor.getInt(cursor.getColumnIndexOrThrow(COL_AUTO_APPLY)) != 0);
    }

    private static String text(Cursor cursor, String column) {
        int index = cursor.getColumnIndexOrThrow(column);
        return cursor.isNull(index) ? "" : cursor.getString(index);
    }

    private static String safeText(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }
}
