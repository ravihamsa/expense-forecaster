package com.finplannar.companion;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.BaseColumns;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;

/**
 * Foreground-only reader for the device SMS inbox. The caller must hold READ_SMS
 * and must only invoke this from an explicit user action (the Scan SMS button).
 */
final class SmsScanner {
    static final Uri INBOX_URI = Uri.parse("content://sms/inbox");

    private static final String[] PROJECTION = {
            BaseColumns._ID, "address", "date", "body", "type"
    };
    private static final String SELECTION = "type = 1 AND date > ?";
    private static final String SORT_ORDER = "date ASC";

    private final ContentResolver resolver;

    SmsScanner(ContentResolver resolver) {
        this.resolver = resolver;
    }

    /** Returns received messages newer than {@code afterMillis}, oldest first. */
    List<SmsItem> scanSince(long afterMillis) {
        List<SmsItem> items = new ArrayList<>();
        Cursor cursor = resolver.query(INBOX_URI, PROJECTION, SELECTION,
                new String[]{String.valueOf(afterMillis)}, SORT_ORDER);
        if (cursor == null) {
            return items;
        }
        try {
            int idIndex = cursor.getColumnIndexOrThrow(BaseColumns._ID);
            int addressIndex = cursor.getColumnIndexOrThrow("address");
            int dateIndex = cursor.getColumnIndexOrThrow("date");
            int bodyIndex = cursor.getColumnIndexOrThrow("body");
            int typeIndex = cursor.getColumnIndexOrThrow("type");

            while (cursor.moveToNext()) {
                String sender = cursor.isNull(addressIndex) ? "" : cursor.getString(addressIndex);
                String body = cursor.isNull(bodyIndex) ? "" : cursor.getString(bodyIndex);
                items.add(new SmsItem(
                        cursor.getLong(idIndex),
                        sender,
                        body,
                        cursor.getLong(dateIndex),
                        cursor.getInt(typeIndex)));
            }
        } finally {
            cursor.close();
        }
        return items;
    }

    /** Stable identity used for on-device deduplication of imported messages. */
    static String fingerprint(SmsItem item) {
        return fingerprint(item.sender, item.smsDate, item.body);
    }

    static String fingerprint(String sender, long smsDate, String body) {
        String source = (sender == null ? "" : sender) + "|" + smsDate + "|" + (body == null ? "" : body);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(source.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(Character.forDigit((value >> 4) & 0x0F, 16));
                hex.append(Character.forDigit(value & 0x0F, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException exception) {
            // SHA-256 is required by the Java platform; this cannot happen in practice.
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
