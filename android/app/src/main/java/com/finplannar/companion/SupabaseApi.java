package com.finplannar.companion;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.Instant;

/**
 * Minimal Supabase client built on HttpURLConnection + org.json only.
 * Credentials come from the session preferences; URL and anon key come from BuildConfig.
 */
final class SupabaseApi {
    private static final String PREFS_NAME = "fp_companion_session";
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";
    private static final String KEY_USER_ID = "user_id";
    private static final String KEY_EMAIL = "email";

    private final SharedPreferences prefs;
    private final String baseUrl;
    private final String anonKey;

    SupabaseApi(Context context) {
        Context appContext = context.getApplicationContext();
        this.prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.baseUrl = BuildConfig.SUPABASE_URL.replaceAll("/+$", "");
        this.anonKey = BuildConfig.SUPABASE_ANON_KEY;
    }

    // ------------------------------------------------------------------ session

    String getAccessToken() {
        return prefs.getString(KEY_TOKEN, "");
    }

    String getUserId() {
        return prefs.getString(KEY_USER_ID, "");
    }

    String getEmail() {
        return prefs.getString(KEY_EMAIL, "");
    }

    boolean isSignedIn() {
        return !getAccessToken().isEmpty() && !getUserId().isEmpty();
    }

    void signOut() {
        prefs.edit().clear().apply();
    }

    void signIn(String email, String password) throws IOException, JSONException {
        requireConfig();
        JSONObject payload = new JSONObject();
        payload.put("email", email);
        payload.put("password", password);

        String response = execute("POST", "/auth/v1/token?grant_type=password",
                payload, false, null);
        JSONObject json = new JSONObject(response);
        String token = json.optString("access_token", "");
        JSONObject user = json.optJSONObject("user");
        String userId = user == null ? "" : user.optString("id", "");
        if (token.isEmpty() || userId.isEmpty()) {
            throw new IOException("Supabase sign-in response did not include access_token and user.id");
        }
        prefs.edit()
                .putString(KEY_TOKEN, token)
                .putString(KEY_REFRESH_TOKEN, json.optString("refresh_token", ""))
                .putString(KEY_USER_ID, userId)
                .putString(KEY_EMAIL, email)
                .apply();
    }

    /**
     * Supabase access tokens expire in about an hour. Refresh before a save so an
     * older session does not silently fail after the user has reviewed many messages.
     */
    void ensureFreshToken() throws IOException, JSONException {
        String token = getAccessToken();
        if (token.isEmpty()) {
            throw new IOException("No Supabase session. Please sign in again.");
        }
        long expiresAt = expiresAt(token);
        if (expiresAt == 0 || expiresAt > System.currentTimeMillis() + 60_000L) {
            return;
        }
        String refreshToken = prefs.getString(KEY_REFRESH_TOKEN, "");
        if (refreshToken.isEmpty()) {
            prefs.edit().clear().apply();
            throw new IOException("Session expired. Please sign in again.");
        }
        JSONObject payload = new JSONObject();
        payload.put("refresh_token", refreshToken);
        String response = execute("POST", "/auth/v1/token?grant_type=refresh_token",
                payload, false, null);
        JSONObject json = new JSONObject(response);
        String newToken = json.optString("access_token", "");
        if (newToken.isEmpty()) {
            prefs.edit().clear().apply();
            throw new IOException("Session refresh failed. Please sign in again.");
        }
        JSONObject user = json.optJSONObject("user");
        String userId = user == null ? getUserId() : user.optString("id", getUserId());
        prefs.edit()
                .putString(KEY_TOKEN, newToken)
                .putString(KEY_REFRESH_TOKEN, json.optString("refresh_token", refreshToken))
                .putString(KEY_USER_ID, userId)
                .putString(KEY_EMAIL, getEmail())
                .apply();
    }

    private static long expiresAt(String token) {
        String[] parts = token.split("\\.");
        if (parts.length < 2) {
            return 0;
        }
        try {
            byte[] decoded = java.util.Base64.getUrlDecoder().decode(parts[1]);
            JSONObject payload = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
            return payload.optLong("exp", 0) * 1000L;
        } catch (Exception ignored) {
            return 0;
        }
    }

    // ---------------------------------------------------------------- dashboard

    /** Currency and display name used to label dashboard totals. */
    JSONArray fetchProfile(String userId) throws IOException, JSONException {
        String path = "/rest/v1/profiles?select=currency,display_name&user_id=eq."
                + URLEncoder.encode(userId, "UTF-8");
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    // ---------------------------------------------------------------- accounts

    /** Account ids and names available to this user, including custom funds. */
    JSONArray fetchAccounts(String userId) throws IOException, JSONException {
        String path = "/rest/v1/accounts?select=id,name,kind,opening_balance&user_id=eq."
                + URLEncoder.encode(userId, "UTF-8")
                + "&order=created_at.asc";
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    /** Reusable expense/income categories from the web app's Categories page. */
    JSONArray fetchCategories(String userId) throws IOException, JSONException {
        String path = "/rest/v1/categories?select=name,kind&user_id=eq."
                + URLEncoder.encode(userId, "UTF-8")
                + "&order=name.asc";
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    /** Add a category from the phone. The id is sent explicitly so older databases work too. */
    void insertCategory(String userId, String id, String name, String kind)
            throws IOException, JSONException {
        JSONObject payload = new JSONObject();
        payload.put("user_id", userId);
        payload.put("id", id);
        payload.put("name", name);
        payload.put("kind", "income".equals(kind) ? "income" : "expense");
        execute("POST", "/rest/v1/categories", payload, true, "return=minimal");
    }

    // --------------------------------------------------------------- cash flows

    /** Planned cash-flow entries for the simple companion list/editor. */
    JSONArray fetchCashFlows(String userId) throws IOException, JSONException {
        String path = "/rest/v1/cash_flows?select="
                + "id,kind,name,amount,category,account,recurrence,interval_count,start_date,source"
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8")
                + "&order=start_date.desc";
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    /** Planned spends (budgets) for the companion's month view. */
    JSONArray fetchBudgets(String userId) throws IOException, JSONException {
        String path = "/rest/v1/budgets?select=id,name,category,monthly_limit,period,start_date,rollover"
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8")
                + "&order=start_date.asc";
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    /** Calendar reschedules of budget occurrences; may not exist on older projects. */
    JSONArray fetchBudgetMoves(String userId) throws IOException, JSONException {
        String path = "/rest/v1/budget_moves?select=budget_id,from_date,to_date&user_id=eq."
                + URLEncoder.encode(userId, "UTF-8");
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    JSONArray fetchMonthlyIncomes(String userId, String month) throws IOException, JSONException {
        String path = "/rest/v1/monthly_incomes?select=month,amount,day,note&user_id=eq."
                + URLEncoder.encode(userId, "UTF-8")
                + "&month=eq." + URLEncoder.encode(month, "UTF-8");
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    /** Recorded amounts in a date range, used by dashboard totals and the month view. */
    JSONArray fetchActuals(String userId, String fromDate, String toDate)
            throws IOException, JSONException {
        String path = "/rest/v1/actuals?select=kind,name,category,amount,date,event_key,account,source"
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8")
                + "&date=gte." + URLEncoder.encode(fromDate, "UTF-8")
                + "&date=lte." + URLEncoder.encode(toDate, "UTF-8");
        String response = execute("GET", path, null, true, null);
        return new JSONArray(response);
    }

    String createCashFlow(JSONObject row) throws IOException, JSONException {
        String response = execute("POST", "/rest/v1/cash_flows", row,
                true, "return=representation");
        JSONArray rows = new JSONArray(response);
        if (rows.length() == 0) {
            throw new IOException("Supabase did not return the inserted cash_flows row");
        }
        String id = rows.getJSONObject(0).optString("id", "");
        if (id.isEmpty()) {
            throw new IOException("Supabase cash_flows row did not include an id");
        }
        return id;
    }

    void updateCashFlow(String id, String userId, JSONObject patch)
            throws IOException, JSONException {
        String path = "/rest/v1/cash_flows?id=eq." + URLEncoder.encode(id, "UTF-8")
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8");
        execute("PATCH", path, patch, true, "return=minimal");
    }

    void deleteCashFlow(String id, String userId) throws IOException {
        String path = "/rest/v1/cash_flows?id=eq." + URLEncoder.encode(id, "UTF-8")
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8");
        execute("DELETE", path, null, true, "return=minimal");
    }

    String insertCashFlow(Candidate candidate, String userId, String dateYyyyMmDd)
            throws IOException, JSONException {
        JSONObject payload = new JSONObject();
        payload.put("user_id", userId);
        payload.put("kind", "income".equals(candidate.kind) ? "income" : "expense");
        payload.put("name", nameOf(candidate));
        payload.put("amount", Math.abs(candidate.amount));
        payload.put("category", valueOr(candidate.category, "Other"));
        payload.put("account", valueOr(candidate.account, "bank"));
        payload.put("recurrence", "one_time");
        payload.put("interval_count", 1);
        payload.put("start_date", dateYyyyMmDd);
        payload.put("end_date", JSONObject.NULL);
        payload.put("source", "sms");
        payload.put("note", "Imported from SMS");

        String response = execute("POST", "/rest/v1/cash_flows", payload,
                true, "return=representation");
        JSONArray rows = new JSONArray(response);
        if (rows.length() == 0) {
            throw new IOException("Supabase did not return the inserted cash_flows row");
        }
        String flowId = rows.getJSONObject(0).optString("id", "");
        if (flowId.isEmpty()) {
            throw new IOException("Supabase cash_flows row did not include an id");
        }
        return flowId;
    }

    void insertActual(String flowId, Candidate candidate, String userId, String dateYyyyMmDd)
            throws IOException, JSONException {
        // SMS spends are recorded only; the web migration links them to a budget when appropriate.
        String eventKey = flowId + "-"
                + LocalDate.parse(dateYyyyMmDd)
                .atStartOfDay(ZoneId.systemDefault())
                .toInstant()
                .toEpochMilli();

        JSONObject payload = new JSONObject();
        payload.put("user_id", userId);
        payload.put("event_key", eventKey);
        payload.put("cash_flow_id", flowId);
        payload.put("date", dateYyyyMmDd);
        payload.put("name", nameOf(candidate));
        payload.put("category", valueOr(candidate.category, ""));
        payload.put("kind", "income".equals(candidate.kind) ? "income" : "expense");
        payload.put("amount", Math.abs(candidate.amount));
        payload.put("account", valueOr(candidate.account, "bank"));
        payload.put("source", "sms");
        payload.put("note", "Imported from SMS");

        // on_conflict keeps a retry idempotent if a later step (e.g. vendor rule) failed.
        execute("POST", "/rest/v1/actuals?on_conflict=user_id,event_key", payload,
                true, "resolution=merge-duplicates,return=representation");
    }

    // -------------------------------------------------------------- vendor rules

    void upsertVendorRule(VendorRule rule, String userId) throws IOException, JSONException {
        JSONObject payload = new JSONObject();
        payload.put("user_id", userId);
        payload.put("vendor_key", rule.vendorKey);
        payload.put("vendor_name", valueOr(rule.vendorName, ""));
        payload.put("kind", "income".equals(rule.kind) ? "income" : "expense");
        payload.put("category", valueOr(rule.category, "Other"));
        payload.put("account", valueOr(rule.account, "bank"));
        payload.put("auto_apply", rule.autoApply);
        payload.put("updated_at", Instant.now().toString());
        // No id: the database default (gen_random_uuid) supplies it.

        execute("POST", "/rest/v1/vendor_rules?on_conflict=user_id,vendor_key", payload,
                true, "resolution=merge-duplicates,return=representation");
    }

    void deleteVendorRule(String vendorKey, String userId) throws IOException {
        String path = "/rest/v1/vendor_rules?user_id=eq."
                + URLEncoder.encode(userId, "UTF-8")
                + "&vendor_key=eq."
                + URLEncoder.encode(vendorKey, "UTF-8");
        execute("DELETE", path, null, true, "return=minimal");
    }

    // --------------------------------------------------------------- HTTP plumbing

    private String execute(String method, String path, JSONObject body,
                           boolean authenticated, String prefer) throws IOException {
        requireConfig();
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("apikey", anonKey);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            if (prefer != null) {
                connection.setRequestProperty("Prefer", prefer);
            }
            if (authenticated) {
                try {
                    ensureFreshToken();
                } catch (JSONException exception) {
                    throw new IOException("Could not refresh Supabase session", exception);
                }
                connection.setRequestProperty("Authorization", "Bearer " + getAccessToken());
            }

            if (body != null) {
                connection.setDoOutput(true);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String response = stream == null ? "" : readAll(stream);
            if (status < 200 || status >= 300) {
                throw new IOException("Supabase " + method + " " + path + " failed ("
                        + status + "): " + snippet(response));
            }
            return response;
        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private static String snippet(String response) {
        String text = response == null ? "" : response.trim().replace("\n", " ");
        return text.length() > 500 ? text.substring(0, 500) + "…" : text;
    }

    private void requireConfig() {
        if (baseUrl.isEmpty() || anonKey.isEmpty()) {
            throw new IllegalStateException(
                    "Supabase is not configured. Copy android/gradle.properties.example to "
                            + "android/gradle.properties and set supabaseUrl and supabaseAnonKey.");
        }
    }

    private static String nameOf(Candidate candidate) {
        return valueOr(candidate.name, valueOr(candidate.merchant, "SMS import"));
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }
}
