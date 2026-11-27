package com.finplannar.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.DialogInterface;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Single-screen companion UI. Everything is built in code; there is no XML layout. */
public final class MainActivity extends Activity {
    private static final int REQUEST_READ_SMS = 42;
    private static final String[] ACCOUNTS = {"cash", "bank"};

    private CompanionDb db;
    private SupabaseApi api;
    private ExecutorService executor;
    private LinearLayout content;
    private TextView statusView;
    private TextView summaryView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new CompanionDb(this);
        api = new SupabaseApi(this);
        executor = Executors.newSingleThreadExecutor();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setBackgroundColor(Color.WHITE);
        content.setPadding(dp(20), dp(24), dp(20), dp(32));
        scroll.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(scroll);

        renderScreen();
    }

    @Override
    protected void onDestroy() {
        if (executor != null) {
            executor.shutdownNow();
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------- screens

    private void renderScreen() {
        statusView = null;
        summaryView = null;
        content.removeAllViews();
        if (api.isSignedIn()) {
            renderMainScreen();
        } else {
            renderAuthScreen();
        }
    }

    private void renderAuthScreen() {
        content.addView(heading("FinPlannar Companion"));
        content.addView(note("Sign in with the same account you use in the FinPlannar web app. "
                + "SMS messages are read only when you tap Scan SMS."));
        content.addView(note(""));

        final EditText email = textField("Email", "");
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        content.addView(email);

        final EditText password = textField("Password", "");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(password);

        final Button[] signInButton = new Button[1];
        final Button signIn = button("Sign in", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                String emailValue = email.getText().toString().trim();
                String passwordValue = password.getText().toString();
                if (emailValue.isEmpty() || passwordValue.isEmpty()) {
                    toast("Enter your email and password");
                    return;
                }
                signInButton[0].setEnabled(false);
                setStatus("Signing in…");
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            api.signIn(emailValue, passwordValue);
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    renderScreen();
                                }
                            });
                        } catch (final Exception error) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    setStatus("Sign-in failed: " + message(error));
                                    signInButton[0].setEnabled(true);
                                    toast("Sign-in failed: " + message(error));
                                }
                            });
                        }
                    }
                });
            }
        });
        signInButton[0] = signIn;
        content.addView(signIn);
        statusView = note("");
        content.addView(statusView);
    }

    private void renderMainScreen() {
        content.addView(heading("FinPlannar Companion"));
        statusView = note(statusText());
        content.addView(statusView);

        content.addView(button("Scan SMS", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                onScanClicked();
            }
        }));
        content.addView(button("Save selected", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                onSaveSelectedClicked();
            }
        }));
        content.addView(button("Vendor rules", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showVendorRules();
            }
        }));
        content.addView(button("Sign out", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                api.signOut();
                renderScreen();
                toast("Signed out");
            }
        }));

        summaryView = note("");
        updateSummary();
        content.addView(summaryView);

        LinearLayout candidates = new LinearLayout(this);
        candidates.setOrientation(LinearLayout.VERTICAL);
        candidates.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        List<Candidate> pending = db.pendingCandidates();
        if (pending.isEmpty()) {
            candidates.addView(note("No pending candidates. Tap Scan SMS to review new messages."));
        } else {
            for (Candidate candidate : pending) {
                addCandidateCard(candidates, candidate);
            }
        }
        content.addView(candidates);
    }

    private void updateSummary() {
        if (summaryView != null) {
            summaryView.setText("Pending: " + db.pendingCandidates().size()
                    + "  •  Synced: " + db.countSynced()
                    + "  •  Ignored: " + db.countIgnored());
        }
    }

    private void addCandidateCard(LinearLayout parent, final Candidate candidate) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.parseColor("#F5F5F5"));
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.topMargin = dp(12);
        card.setLayoutParams(cardParams);

        String date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                .format(new Date(candidate.smsDate));
        TextView header = new TextView(this);
        header.setText(candidate.sender + "  •  " + date);
        header.setTextSize(15f);
        header.setTypeface(Typeface.DEFAULT_BOLD);
        card.addView(header);

        String snippet = candidate.body.replaceAll("\\s+", " ").trim();
        if (snippet.length() > 160) {
            snippet = snippet.substring(0, 160) + "…";
        }
        card.addView(note(snippet));
        card.addView(note(String.format(Locale.getDefault(), "%s  •  %s",
                candidate.kind, candidate.source)));

        final EditText amount = textField("Amount (₹)", String.format(Locale.US,
                "%.2f", candidate.amount));
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        card.addView(amount);

        final EditText name = textField("Name", candidate.name);
        card.addView(name);
        final EditText category = textField("Category", candidate.category);
        card.addView(category);

        final Spinner account = accountSpinner(candidate.account);
        card.addView(account);

        LinearLayout choices = new LinearLayout(this);
        choices.setOrientation(LinearLayout.HORIZONTAL);
        choices.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        choices.addView(choiceButton("Expense", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                applyChoice(candidate, amount, name, category, account, "expense", false);
            }
        }));
        choices.addView(choiceButton("Income", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                applyChoice(candidate, amount, name, category, account, "income", false);
            }
        }));
        choices.addView(choiceButton("Ignore", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                applyChoice(candidate, amount, name, category, account, candidate.kind, true);
            }
        }));
        card.addView(choices);

        parent.addView(card);
    }

    private void applyChoice(Candidate candidate, EditText amount, EditText name,
                             EditText category, Spinner account, String kind, boolean ignored) {
        String accountValue = String.valueOf(account.getSelectedItem());
        double amountValue = parseAmount(amount.getText().toString());
        if (!ignored && amountValue <= 0) {
            toast("Enter a valid amount before choosing Expense or Income");
            return;
        }
        db.updateCandidateChoice(candidate.fingerprint, amountValue,
                name.getText().toString(), category.getText().toString(),
                accountValue, kind);
        if (ignored) {
            db.markIgnored(candidate.fingerprint);
        }
        renderScreen();
    }

    private static double parseAmount(String value) {
        try {
            return Math.abs(Double.parseDouble(value.replace(",", "").replace("₹", "").trim()));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    // -------------------------------------------------------------- scan & save

    private void onScanClicked() {
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_SMS}, REQUEST_READ_SMS);
            return;
        }
        runScan();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_READ_SMS) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            runScan();
        } else {
            setStatus("READ_SMS permission is required to scan messages.");
            toast("READ_SMS permission is required to scan messages.");
        }
    }

    private void runScan() {
        final long lastScanAt = db.getLastScanAt();
        final ContentResolver resolver = getContentResolver();
        setStatus("Scanning received SMS…");
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    SmsScanner scanner = new SmsScanner(resolver);
                    TransactionParser parser = new TransactionParser(db);
                    List<SmsItem> messages = scanner.scanSince(lastScanAt);
                    long maxDate = lastScanAt;
                    int inserted = 0;
                    for (SmsItem message : messages) {
                        String fingerprint = SmsScanner.fingerprint(message);
                        if (!db.hasFingerprint(fingerprint)) {
                            if (db.insertCandidate(parser.parse(message))) {
                                inserted++;
                            }
                        }
                        maxDate = Math.max(maxDate, message.smsDate);
                    }
                    // The cursor advances past everything we read; fingerprint dedupe
                    // protects against any message that was already stored.
                    if (maxDate > lastScanAt) {
                        db.setLastScanAt(maxDate);
                    }
                    final int count = inserted;
                    final int read = messages.size();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            toast("Read " + read + " messages, " + count + " new candidates");
                            renderScreen();
                        }
                    });
                } catch (final Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setStatus("Scan failed: " + message(error));
                            toast("Scan failed: " + message(error));
                        }
                    });
                }
            }
        });
    }

    private void onSaveSelectedClicked() {
        final String userId = api.getUserId();
        if (userId.isEmpty()) {
            toast("Please sign in again");
            return;
        }
        setStatus("Saving confirmed transactions…");
        executor.execute(new Runnable() {
            @Override
            public void run() {
                int synced = 0;
                int ignored = 0;
                int failed = 0;
                String firstError = null;
                for (Candidate candidate : db.pendingCandidates()) {
                    try {
                        String date = dateOf(candidate.smsDate);
                        if (candidate.ignored) {
                            db.markSynced(candidate.fingerprint);
                            ignored++;
                            continue;
                        }
                        if (candidate.amount <= 0) {
                            failed++;
                            if (firstError == null) {
                                firstError = "One candidate has no valid amount. Tap Expense or "
                                        + "Income again after entering an amount.";
                            }
                            continue;
                        }

                        String flowId = candidate.remoteFlowId == null ? "" : candidate.remoteFlowId.trim();
                        if (flowId.isEmpty()) {
                            flowId = api.insertCashFlow(candidate, userId, date);
                            db.setRemoteFlowId(candidate.fingerprint, flowId);
                            candidate.remoteFlowId = flowId;
                        }
                        api.insertActual(flowId, candidate, userId, date);

                        if (!candidate.merchant.trim().isEmpty()) {
                            VendorRule rule = new VendorRule(
                                    TransactionParser.vendorKey(candidate.sender, candidate.merchant),
                                    candidate.name,
                                    candidate.kind,
                                    candidate.category,
                                    candidate.account,
                                    true);
                            api.upsertVendorRule(rule, userId);
                            db.upsertVendorRule(rule);
                        }
                        db.markSynced(candidate.fingerprint);
                        synced++;
                    } catch (Exception error) {
                        failed++;
                        if (firstError == null) {
                            firstError = message(error);
                        }
                        // Leave this row unsynced so the user can retry. A stored
                        // remoteFlowId is reused to avoid duplicate cash flows.
                    }
                }

                final int savedCount = synced;
                final int ignoredCount = ignored;
                final int failedCount = failed;
                final String errorText = firstError;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        String summary = "Saved " + savedCount + ", ignored " + ignoredCount
                                + (failedCount > 0 ? ", failed " + failedCount : "");
                        toast(summary);
                        renderScreen();
                        if (errorText != null) {
                            setStatus("Some rows failed: " + errorText);
                        }
                    }
                });
            }
        });
    }

    // ------------------------------------------------------------- vendor rules

    private void showVendorRules() {
        final List<VendorRule> rules = db.allVendorRules();
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("Vendor rules");
        if (rules.isEmpty()) {
            builder.setMessage("No learned rules yet. Confirm an import to teach the app a vendor.");
        } else {
            String[] labels = new String[rules.size()];
            for (int index = 0; index < rules.size(); index++) {
                VendorRule rule = rules.get(index);
                labels[index] = rule.vendorName + " — " + rule.kind + " / "
                        + rule.category + " / " + rule.account + "\n" + rule.vendorKey;
            }
            builder.setItems(labels, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    confirmDeleteRule(rules.get(which));
                }
            });
        }
        builder.setNegativeButton("Close", null).show();
    }

    private void confirmDeleteRule(final VendorRule rule) {
        new AlertDialog.Builder(this)
                .setTitle("Delete vendor rule?")
                .setMessage(rule.vendorName + "\n" + rule.vendorKey)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Delete", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        db.deleteVendorRule(rule.vendorKey);
                        final String userId = api.getUserId();
                        executor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    if (!userId.isEmpty()) {
                                        api.deleteVendorRule(rule.vendorKey, userId);
                                    }
                                } catch (final Exception error) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            toast("Local rule deleted; remote delete failed: "
                                                    + message(error));
                                        }
                                    });
                                }
                            }
                        });
                        toast("Rule deleted: " + rule.vendorName);
                    }
                })
                .show();
    }

    // --------------------------------------------------------------- view helpers

    private TextView heading(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(22f);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        return withTopMargin(view, dp(4));
    }

    private TextView note(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(14f);
        return withTopMargin(view, dp(8));
    }

    private EditText textField(String hint, String value) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setText(value == null ? "" : value);
        view.setTextSize(16f);
        return withTopMargin(view, dp(8));
    }

    private Button button(String label, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setOnClickListener(listener);
        return withTopMargin(view, dp(12));
    }

    private Button choiceButton(String label, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextSize(13f);
        view.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.topMargin = dp(10);
        if (!"Expense".equals(label)) {
            params.leftMargin = dp(6);
        }
        view.setLayoutParams(params);
        return view;
    }

    private Spinner accountSpinner(String selected) {
        Spinner view = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_1, ACCOUNTS) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                return accountTextView(getItem(position));
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                return accountTextView(getItem(position));
            }
        };
        view.setAdapter(adapter);
        view.setSelection("cash".equals(selected) ? 0 : 1);
        return withTopMargin(view, dp(8));
    }

    private TextView accountTextView(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(16f);
        view.setPadding(dp(10), dp(8), dp(10), dp(8));
        return view;
    }

    private static <T extends View> T withTopMargin(T view, int margin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = margin;
        view.setLayoutParams(params);
        return view;
    }

    private void setStatus(String text) {
        if (statusView != null) {
            statusView.setText(text);
        }
    }

    private String statusText() {
        long last = db.getLastScanAt();
        String when = last == 0 ? "never"
                : DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                .format(new Date(last));
        return "Signed in as " + api.getEmail() + "\nLast scan: " + when;
    }

    private static String dateOf(long timestampMillis) {
        long safeTimestamp = timestampMillis > 0 ? timestampMillis : System.currentTimeMillis();
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(safeTimestamp));
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private static String message(Exception error) {
        String text = error.getMessage();
        return text == null || text.trim().isEmpty() ? error.getClass().getSimpleName() : text;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                getResources().getDisplayMetrics()));
    }
}
