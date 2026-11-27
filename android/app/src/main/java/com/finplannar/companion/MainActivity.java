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
import android.widget.AdapterView;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Small tabbed companion UI. Everything is built in code; there is no XML layout. */
public final class MainActivity extends Activity {
    private static final int REQUEST_READ_SMS = 42;
    private static final int REQUEST_READ_SMS_CSV = 43;
    private static final int SCAN_BATCH_LIMIT = 50;
    private static final int CSV_BATCH_LIMIT = 100;
    private static final int VISIBLE_CANDIDATE_LIMIT = 20;

    private static final String[] DEFAULT_EXPENSE_CATEGORIES = {
            "Housing", "Utilities", "Groceries", "Transport", "Insurance", "Health", "Education",
            "Shopping", "Dining", "Entertainment", "Subscriptions", "Travel", "Lifestyle",
            "Hobbies", "Investments", "Other"
    };

    private static final String[] DEFAULT_INCOME_CATEGORIES = {
            "Salary", "Business", "Freelance", "Rent Received", "Interest", "Dividends", "Gifts", "Other"
    };

    private static final String[] RECURRENCES = {
            "monthly", "one_time", "yearly", "every_n_months", "every_n_years"
    };

    private enum Screen { SCAN, DASHBOARD, CASH_FLOWS, CATEGORIES }

    private static final class AccountOption {
        final String id;
        final String name;
        final double openingBalance;

        AccountOption(String id, String name) {
            this(id, name, 0);
        }

        AccountOption(String id, String name, double openingBalance) {
            this.id = id;
            this.name = name;
            this.openingBalance = openingBalance;
        }
    }

    private CompanionDb db;
    private SupabaseApi api;
    private ExecutorService executor;
    private LinearLayout content;
    private TextView statusView;
    private TextView summaryView;
    private Screen screen = Screen.SCAN;
    private final List<AccountOption> accountOptions = new ArrayList<>();
    private final List<String> categoryOptions = new ArrayList<>();
    private final List<String> expenseCategoryOptions = new ArrayList<>();
    private final List<String> incomeCategoryOptions = new ArrayList<>();
    private final List<CashFlowRow> cashFlowRows = new ArrayList<>();
    private String dashboardStatus = "Loading dashboard…";
    private String dashboardCurrency = "INR";
    private double dashboardOpeningTotal;
    private double dashboardPlannedIncome;
    private double dashboardPlannedExpense;
    private double dashboardActualIncome;
    private double dashboardActualExpense;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        db = new CompanionDb(this);
        api = new SupabaseApi(this);
        executor = Executors.newSingleThreadExecutor();
        accountOptions.add(new AccountOption("cash", "Cash in hand"));
        accountOptions.add(new AccountOption("bank", "Bank balance"));
        for (String category : DEFAULT_EXPENSE_CATEGORIES) {
            if (!expenseCategoryOptions.contains(category)) expenseCategoryOptions.add(category);
            if (!categoryOptions.contains(category)) categoryOptions.add(category);
        }
        for (String category : DEFAULT_INCOME_CATEGORIES) {
            if (!incomeCategoryOptions.contains(category)) incomeCategoryOptions.add(category);
            if (!categoryOptions.contains(category)) categoryOptions.add(category);
        }

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
        loadAccounts();
        loadCategories();
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
        if (!api.isSignedIn()) {
            renderAuthScreen();
            return;
        }
        switch (screen) {
            case DASHBOARD:
                renderDashboardScreen();
                break;
            case CASH_FLOWS:
                renderCashFlowsScreen();
                break;
            case CATEGORIES:
                renderCategoriesScreen();
                break;
            default:
                renderMainScreen();
                break;
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
                                    screen = Screen.SCAN;
                                    renderScreen();
                                    loadAccounts();
                                    loadCategories();
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
        renderNav();
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
        content.addView(button("Export CSV", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                onExportCsvClicked();
            }
        }));
        content.addView(button("Sign out", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                api.signOut();
                screen = Screen.SCAN;
                renderScreen();
                toast("Signed out");
            }
        }));

        final long monthStart = startOfCurrentMonthMillis();
        summaryView = note("");
        updateSummary(monthStart);
        content.addView(summaryView);

        LinearLayout candidates = new LinearLayout(this);
        candidates.setOrientation(LinearLayout.VERTICAL);
        candidates.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        List<Candidate> pending = db.pendingCandidates(monthStart, VISIBLE_CANDIDATE_LIMIT);
        int pendingCount = db.countPending(monthStart);
        if (pending.isEmpty()) {
            candidates.addView(note("No current-month messages need review. Tap Scan SMS to find more."));
        } else {
            for (Candidate candidate : pending) {
                addCandidateCard(candidates, candidate);
            }
            if (pendingCount > pending.size()) {
                candidates.addView(note("Showing " + pending.size() + " of " + pendingCount
                        + " current-month messages awaiting review. Choose Expense, Income or Ignore "
                        + "to move them to Save selected."));
            }
        }
        content.addView(candidates);
    }

    // ------------------------------------------------------------ nav + dashboard

    private void renderNav() {
        LinearLayout first = navRow();
        first.addView(choiceButton("Dashboard", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                screen = Screen.DASHBOARD;
                dashboardStatus = "Loading dashboard…";
                loadDashboard();
                renderScreen();
            }
        }));
        first.addView(choiceButton("Cash flows", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                screen = Screen.CASH_FLOWS;
                renderScreen();
                loadCashFlows();
            }
        }));
        content.addView(first);

        LinearLayout second = navRow();
        second.addView(choiceButton("Categories", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                screen = Screen.CATEGORIES;
                renderScreen();
            }
        }));
        second.addView(choiceButton("SMS review", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                screen = Screen.SCAN;
                renderScreen();
            }
        }));
        content.addView(second);
    }

    private void renderDashboardScreen() {
        content.addView(heading("Dashboard"));
        renderNav();
        content.addView(note(dashboardStatus));

        double plannedNet = dashboardPlannedIncome - dashboardPlannedExpense;
        double actualNet = dashboardActualIncome - dashboardActualExpense;
        content.addView(note("Starting balance across accounts: "
                + dashboardCurrency + " " + money(dashboardOpeningTotal)));
        content.addView(note("Planned this month: +" + money(dashboardPlannedIncome)
                + " income / -" + money(dashboardPlannedExpense)
                + " expenses = " + (plannedNet >= 0 ? "+" : "") + money(plannedNet)));
        content.addView(note("Recorded this month: +" + money(dashboardActualIncome)
                + " income / -" + money(dashboardActualExpense)
                + " expenses = " + (actualNet >= 0 ? "+" : "") + money(actualNet)));
        content.addView(note("Simple projection at month end: " + dashboardCurrency + " "
                + money(dashboardOpeningTotal + plannedNet)));

        content.addView(note("Accounts"));
        for (AccountOption account : accountOptions) {
            content.addView(note(account.name + " — " + dashboardCurrency + " "
                    + money(account.openingBalance)));
        }

        content.addView(note("Recent planned entries"));
        int shown = 0;
        for (CashFlowRow row : cashFlowRows) {
            if (shown >= 5) break;
            content.addView(note(row.name + " • " + row.kind + " • "
                    + money(row.amount) + " • " + row.startDate));
            shown += 1;
        }
        if (shown == 0) content.addView(note("No planned entries yet. Add one in Cash flows."));

        content.addView(button("Refresh dashboard", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                dashboardStatus = "Refreshing dashboard…";
                loadDashboard();
                renderScreen();
            }
        }));
    }

    private void loadDashboard() {
        if (!api.isSignedIn()) return;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final String userId = api.getUserId();
                    YearMonth month = YearMonth.now();
                    String from = month.atDay(1).toString();
                    String to = month.atEndOfMonth().toString();

                    JSONArray profileRows = api.fetchProfile(userId);
                    JSONArray accountRows = api.fetchAccounts(userId);
                    JSONArray flowRows = api.fetchCashFlows(userId);
                    JSONArray actualRows = api.fetchActuals(userId, from, to);

                    final String currency = profileRows.length() > 0
                            ? valueOr(profileRows.getJSONObject(0).optString("currency", ""), "INR")
                            : "INR";
                    final List<AccountOption> loadedAccounts = new ArrayList<AccountOption>();
                    final double[] openingTotal = {0};
                    for (int index = 0; index < accountRows.length(); index += 1) {
                        JSONObject row = accountRows.getJSONObject(index);
                        String id = row.optString("id", "");
                        if (id.isEmpty()) continue;
                        double balance = row.optDouble("opening_balance", 0);
                        loadedAccounts.add(new AccountOption(
                                id, valueOr(row.optString("name", ""), id), balance));
                        openingTotal[0] += balance;
                    }

                    final List<CashFlowRow> loadedFlows = cashFlowRowsFrom(flowRows);
                    final double[] plannedIncome = {0};
                    final double[] plannedExpense = {0};
                    for (CashFlowRow flow : loadedFlows) {
                        if (!occursInMonth(flow, month)) continue;
                        if ("income".equals(flow.kind)) {
                            plannedIncome[0] += flow.amount;
                        } else {
                            plannedExpense[0] += flow.amount;
                        }
                    }

                    final double[] actualIncome = {0};
                    final double[] actualExpense = {0};
                    for (int index = 0; index < actualRows.length(); index += 1) {
                        JSONObject row = actualRows.getJSONObject(index);
                        double amount = row.optDouble("amount", 0);
                        if ("income".equals(row.optString("kind", ""))) {
                            actualIncome[0] += amount;
                        } else {
                            actualExpense[0] += amount;
                        }
                    }

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.DASHBOARD) return;
                            if (!loadedAccounts.isEmpty()) {
                                accountOptions.clear();
                                accountOptions.addAll(loadedAccounts);
                            }
                            cashFlowRows.clear();
                            cashFlowRows.addAll(loadedFlows);
                            dashboardCurrency = currency;
                            dashboardOpeningTotal = openingTotal[0];
                            dashboardPlannedIncome = plannedIncome[0];
                            dashboardPlannedExpense = plannedExpense[0];
                            dashboardActualIncome = actualIncome[0];
                            dashboardActualExpense = actualExpense[0];
                            dashboardStatus = "Updated " + dateTimeOf(System.currentTimeMillis());
                            renderScreen();
                        }
                    });
                } catch (final Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.DASHBOARD) return;
                            dashboardStatus = "Dashboard failed: " + message(error);
                            renderScreen();
                        }
                    });
                }
            }
        });
    }

    // ------------------------------------------------------------- cash flow CRUD

    private void renderCashFlowsScreen() {
        content.addView(heading("Cash flows"));
        renderNav();
        content.addView(note("Edit planned entries here. SMS imports keep their source tag."));
        content.addView(button("Add cash flow", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showCashFlowDialog(null);
            }
        }));

        if (cashFlowRows.isEmpty()) {
            content.addView(note("No cash-flow entries yet. Add one to include it in your plan."));
            return;
        }

        for (final CashFlowRow flow : cashFlowRows) {
            LinearLayout card = card();
            TextView title = note(flow.name);
            title.setTextSize(16f);
            title.setTypeface(Typeface.DEFAULT_BOLD);
            card.addView(title);
            card.addView(note(flow.kind + " • " + money(flow.amount) + " • "
                    + flow.category + " • " + accountLabel(flow.account)));
            card.addView(note("Schedule: " + flow.recurrence + " • from " + flow.startDate
                    + ("sms".equals(flow.source) ? " • SMS import" : "")));
            LinearLayout actions = navRow();
            actions.addView(choiceButton("Edit", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showCashFlowDialog(flow);
                }
            }));
            actions.addView(choiceButton("Delete", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    confirmDeleteCashFlow(flow);
                }
            }));
            card.addView(actions);
            content.addView(card);
        }
    }

    private void loadCashFlows() {
        if (!api.isSignedIn()) return;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final List<CashFlowRow> loaded = cashFlowRowsFrom(
                            api.fetchCashFlows(api.getUserId()));
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.CASH_FLOWS) return;
                            cashFlowRows.clear();
                            cashFlowRows.addAll(loaded);
                            renderScreen();
                        }
                    });
                } catch (final Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen == Screen.CASH_FLOWS) {
                                toast("Could not load cash flows: " + message(error));
                            }
                        }
                    });
                }
            }
        });
    }

    private void showCashFlowDialog(final CashFlowRow existing) {
        final boolean editing = existing != null;
        String initialKind = editing ? existing.kind : "expense";
        String initialCategory = editing ? existing.category : "Other";
        String initialAccount = editing ? existing.account : "bank";
        String initialStartDate = editing ? existing.startDate : dateOf(System.currentTimeMillis());

        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        final EditText name = textField("Name", editing ? existing.name : "");
        form.addView(name);
        final EditText amount = textField("Amount", editing ? String.valueOf(existing.amount) : "");
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        form.addView(amount);

        form.addView(note("Kind"));
        final Spinner kind = stringSpinner(new String[]{"income", "expense"}, initialKind);
        form.addView(kind);
        form.addView(note("Category"));
        final Spinner category = stringSpinner(categoryNamesFor(initialKind).toArray(new String[0]),
                initialCategory);
        form.addView(category);
        final Spinner[] categoryHolder = new Spinner[1];
        categoryHolder[0] = category;
        kind.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String nextKind = String.valueOf(parent.getItemAtPosition(position));
                List<String> names = categoryNamesFor(nextKind);
                String current = String.valueOf(categoryHolder[0].getSelectedItem());
                String selected = containsIgnoreCase(names, current)
                        ? current : (names.isEmpty() ? "Other" : names.get(0));
                setSpinnerItems(categoryHolder[0], names, selected);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        form.addView(note("Account"));
        final Spinner account = accountSpinner(initialAccount);
        form.addView(account);
        form.addView(note("Schedule"));
        final Spinner recurrence = stringSpinner(RECURRENCES,
                editing ? existing.recurrence : "monthly");
        form.addView(recurrence);
        final EditText startDate = textField("Start date (YYYY-MM-DD)", initialStartDate);
        form.addView(startDate);
        final EditText interval = textField("Repeat every N months / years",
                String.valueOf(editing ? existing.intervalCount : 1));
        interval.setInputType(InputType.TYPE_CLASS_NUMBER);
        form.addView(interval);

        final AlertDialog[] dialogHolder = new AlertDialog[1];
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(editing ? "Edit cash flow" : "Add cash flow")
                .setView(form)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", null)
                .create();
        dialogHolder[0] = dialog;
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                final Button save = dialogHolder[0].getButton(AlertDialog.BUTTON_POSITIVE);
                save.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) {
                        String nameValue = name.getText().toString().trim();
                        if (nameValue.isEmpty()) {
                            toast("Enter a name");
                            return;
                        }
                        double amountValue = parseAmount(amount.getText().toString());
                        if (amountValue <= 0) {
                            toast("Enter an amount greater than zero");
                            return;
                        }
                        String dateValue = startDate.getText().toString().trim();
                        try {
                            LocalDate.parse(dateValue);
                        } catch (Exception error) {
                            toast("Use a date like 2026-11-27");
                            return;
                        }
                        int intervalValue = 1;
                        try {
                            intervalValue = Integer.parseInt(interval.getText().toString().trim());
                        } catch (Exception error) {
                            toast("Repeat interval must be a whole number");
                            return;
                        }
                        if (intervalValue < 1) {
                            toast("Repeat interval must be at least 1");
                            return;
                        }

                        final JSONObject payload = new JSONObject();
                        try {
                            payload.put("kind", String.valueOf(kind.getSelectedItem()));
                            payload.put("name", nameValue);
                            payload.put("amount", amountValue);
                            payload.put("category", String.valueOf(categoryHolder[0].getSelectedItem()));
                            payload.put("account", String.valueOf(account.getSelectedItem()));
                            payload.put("recurrence", String.valueOf(recurrence.getSelectedItem()));
                            payload.put("interval_count", intervalValue);
                            payload.put("start_date", dateValue);
                            payload.put("end_date", JSONObject.NULL);
                            payload.put("source", editing ? existing.source : "manual");
                            payload.put("note", "");
                        } catch (JSONException error) {
                            toast("Could not build this entry: " + message(error));
                            return;
                        }

                        save.setEnabled(false);
                        executor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    String userId = api.getUserId();
                                    if (editing) {
                                        api.updateCashFlow(existing.id, userId, payload);
                                    } else {
                                        payload.put("user_id", userId);
                                        api.createCashFlow(payload);
                                    }
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            dialogHolder[0].dismiss();
                                            toast(editing ? "Cash flow updated" : "Cash flow added");
                                            loadCashFlows();
                                            if (screen == Screen.DASHBOARD) loadDashboard();
                                        }
                                    });
                                } catch (final Exception error) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            save.setEnabled(true);
                                            toast("Could not save cash flow: " + message(error));
                                        }
                                    });
                                }
                            }
                        });
                    }
                });
            }
        });
        dialog.show();
    }

    private void confirmDeleteCashFlow(final CashFlowRow flow) {
        new AlertDialog.Builder(this)
                .setTitle("Delete cash flow?")
                .setMessage("Remove \"" + flow.name + "\" from your plan? Recorded actuals stay untouched.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Delete", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialogInterface, int which) {
                        executor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    api.deleteCashFlow(flow.id, api.getUserId());
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            toast("Cash flow deleted");
                                            loadCashFlows();
                                            if (screen == Screen.DASHBOARD) loadDashboard();
                                        }
                                    });
                                } catch (final Exception error) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            toast("Could not delete cash flow: " + message(error));
                                        }
                                    });
                                }
                            }
                        });
                    }
                })
                .show();
    }

    // ------------------------------------------------------------------ categories

    private void renderCategoriesScreen() {
        content.addView(heading("Categories"));
        renderNav();
        content.addView(note("Names added here are available in cash flows and SMS review."));
        content.addView(button("Add category", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showAddCategoryDialog();
            }
        }));

        content.addView(note("Expense categories"));
        for (String category : expenseCategoryOptions) {
            content.addView(note("• " + category));
        }
        content.addView(note("Income categories"));
        for (String category : incomeCategoryOptions) {
            content.addView(note("• " + category));
        }
        content.addView(note("Other is the fallback and always exists in both lists."));
    }

    private void showAddCategoryDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        final EditText name = textField("Category name", "");
        form.addView(name);
        form.addView(note("List"));
        final Spinner kind = stringSpinner(new String[]{"expense", "income"}, "expense");
        form.addView(kind);

        final AlertDialog[] dialogHolder = new AlertDialog[1];
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Add category")
                .setView(form)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Add", null)
                .create();
        dialogHolder[0] = dialog;
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                final Button save = dialogHolder[0].getButton(AlertDialog.BUTTON_POSITIVE);
                save.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) {
                        final String clean = name.getText().toString().trim();
                        if (clean.isEmpty()) {
                            toast("Enter a category name");
                            return;
                        }
                        final String kindValue = String.valueOf(kind.getSelectedItem());
                        List<String> target = "income".equals(kindValue)
                                ? incomeCategoryOptions : expenseCategoryOptions;
                        if (containsIgnoreCase(target, clean)) {
                            toast("That category already exists");
                            return;
                        }
                        final String id = UUID.randomUUID().toString();
                        save.setEnabled(false);
                        executor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    api.insertCategory(api.getUserId(), id, clean, kindValue);
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if ("income".equals(kindValue)) {
                                                incomeCategoryOptions.add(clean);
                                            } else {
                                                expenseCategoryOptions.add(clean);
                                            }
                                            if (!categoryOptions.contains(clean)) {
                                                categoryOptions.add(clean);
                                            }
                                            dialogHolder[0].dismiss();
                                            toast("Category added");
                                            renderScreen();
                                        }
                                    });
                                } catch (final Exception error) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            save.setEnabled(true);
                                            toast("Could not add category: " + message(error));
                                        }
                                    });
                                }
                            }
                        });
                    }
                });
            }
        });
        dialog.show();
    }

    private void updateSummary(long monthStart) {
        if (summaryView != null) {
            summaryView.setText("To review: " + db.countPending(monthStart)
                    + "  •  Ready to save: " + db.countReadyToSave(monthStart)
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
        final Spinner category = categorySpinner(candidate.category);
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
                             Spinner category, Spinner account, String kind, boolean ignored) {
        String accountValue = String.valueOf(account.getSelectedItem());
        String categoryValue = String.valueOf(category.getSelectedItem());
        double amountValue = parseAmount(amount.getText().toString());
        if (!ignored && amountValue <= 0) {
            toast("Enter a valid amount before choosing Expense or Income");
            return;
        }
        db.updateCandidateChoice(candidate.fingerprint, amountValue,
                name.getText().toString(), categoryValue,
                accountValue, kind);
        if (ignored) {
            db.markIgnored(candidate.fingerprint);
        }
        String action = ignored ? "Ignored"
                : "income".equals(kind) ? "Marked as income" : "Marked as expense";
        toast(action + ". Tap Save selected to sync.");
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

    private void onExportCsvClicked() {
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_SMS}, REQUEST_READ_SMS_CSV);
            return;
        }
        runCsvExport();
    }

    private void runCsvExport() {
        final long monthStart = startOfCurrentMonthMillis();
        setStatus("Exporting current-month SMS to CSV…");
        executor.execute(new Runnable() {
            @Override
            public void run() {
                File folder = getExternalFilesDir(null);
                if (folder == null) {
                    showCsvError("App storage is unavailable");
                    return;
                }
                File file = new File(folder, "finplannar-sms-review.csv");
                try {
                    SmsScanner scanner = new SmsScanner(getContentResolver());
                    TransactionParser parser = new TransactionParser(db);
                    long afterId = 0;
                    int rows = 0;
                    Writer output = new OutputStreamWriter(
                            new FileOutputStream(file), StandardCharsets.UTF_8);
                    try (BufferedWriter writer = new BufferedWriter(output)) {
                        writeCsvRow(writer, "date", "sender", "body", "amount", "kind",
                                "merchant", "category", "account", "source");
                        while (true) {
                            List<SmsItem> batch = scanner.scanSince(
                                    monthStart, afterId, CSV_BATCH_LIMIT);
                            for (SmsItem item : batch) {
                                Candidate candidate = parser.parse(item);
                                writeCsvRow(writer,
                                        dateTimeOf(item.smsDate),
                                        item.sender,
                                        item.body.replaceAll("\\s+", " ").trim(),
                                        String.valueOf(candidate.amount),
                                        candidate.kind,
                                        candidate.merchant,
                                        candidate.category,
                                        candidate.account,
                                        candidate.source);
                                afterId = Math.max(afterId, item.id);
                                rows++;
                            }
                            if (batch.size() < CSV_BATCH_LIMIT) {
                                break;
                            }
                        }
                    }
                    final String path = file.getAbsolutePath();
                    final int count = rows;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setStatus("CSV exported: " + count + " messages\n" + path);
                            toast("CSV exported (" + count + " messages)");
                        }
                    });
                } catch (final Exception error) {
                    showCsvError(message(error));
                }
            }
        });
    }

    private void showCsvError(final String error) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setStatus("CSV export failed: " + error);
                toast("CSV export failed: " + error);
            }
        });
    }

    private static void writeCsvRow(BufferedWriter writer, String... values) throws IOException {
        for (int index = 0; index < values.length; index++) {
            if (index > 0) {
                writer.write(',');
            }
            String value = values[index] == null ? "" : values[index];
            writer.write('"');
            writer.write(value.replace("\"", "\"\""));
            writer.write('"');
        }
        writer.newLine();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQUEST_READ_SMS) {
            if (granted) {
                runScan();
            } else {
                setStatus("READ_SMS permission is required to scan messages.");
                toast("READ_SMS permission is required to scan messages.");
            }
        } else if (requestCode == REQUEST_READ_SMS_CSV) {
            if (granted) {
                runCsvExport();
            } else {
                setStatus("READ_SMS permission is required to export SMS data.");
                toast("READ_SMS permission is required to export SMS data.");
            }
        }
    }

    private void runScan() {
        final long monthStart = startOfCurrentMonthMillis();
        final long lastId = db.getLastScanId();
        final ContentResolver resolver = getContentResolver();
        setStatus("Scanning current-month SMS…");
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    SmsScanner scanner = new SmsScanner(resolver);
                    TransactionParser parser = new TransactionParser(db);
                    List<SmsItem> messages = scanner.scanSince(
                            monthStart, lastId, SCAN_BATCH_LIMIT);
                    long maxId = lastId;
                    long maxDate = 0;
                    int inserted = 0;
                    for (SmsItem message : messages) {
                        String fingerprint = SmsScanner.fingerprint(message);
                        if (!db.hasFingerprint(fingerprint)
                                && db.insertCandidate(parser.parse(message))) {
                            inserted++;
                        }
                        maxId = Math.max(maxId, message.id);
                        maxDate = Math.max(maxDate, message.smsDate);
                    }
                    // The id cursor advances only past messages we actually processed, so
                    // a batch limit never skips older current-month messages.
                    if (!messages.isEmpty()) {
                        db.setLastScanId(maxId);
                        if (maxDate > 0) {
                            db.setLastScanAt(maxDate);
                        }
                    }
                    final int count = inserted;
                    final int read = messages.size();
                    final boolean hasMore = read >= SCAN_BATCH_LIMIT;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            String result = "Read " + read + " current-month messages, "
                                    + count + " new candidates";
                            if (hasMore) {
                                result += " — tap Scan again for the next batch";
                            }
                            toast(result);
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
        final long monthStart = startOfCurrentMonthMillis();
        setStatus("Saving confirmed transactions…");
        executor.execute(new Runnable() {
            @Override
            public void run() {
                int synced = 0;
                int ignored = 0;
                int failed = 0;
                String firstError = null;
                for (Candidate candidate : db.reviewedCandidates(monthStart)) {
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

    /** Pull the user's accounts from Supabase so custom funds appear in review cards. */
    private void loadAccounts() {
        if (!api.isSignedIn()) return;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONArray rows = api.fetchAccounts(api.getUserId());
                    final List<AccountOption> loaded = new ArrayList<AccountOption>();
                    for (int index = 0; index < rows.length(); index += 1) {
                        JSONObject row = rows.getJSONObject(index);
                        String id = row.optString("id", "");
                        if (id.isEmpty()) continue;
                        loaded.add(new AccountOption(id,
                                valueOr(row.optString("name", ""), id),
                                row.optDouble("opening_balance", 0)));
                    }
                    if (loaded.isEmpty()) return;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            accountOptions.clear();
                            accountOptions.addAll(loaded);
                            renderScreen();
                        }
                    });
                } catch (Exception error) {
                    // Offline or no accounts table yet: keep cash/bank defaults.
                }
            }
        });
    }

    /** Pull the user's reusable category list from Supabase so review cards match the web app. */
    private void loadCategories() {
        if (!api.isSignedIn()) return;
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONArray rows = api.fetchCategories(api.getUserId());
                    final List<String> loaded = new ArrayList<String>();
                    final List<String> loadedExpense = new ArrayList<String>();
                    final List<String> loadedIncome = new ArrayList<String>();
                    for (int index = 0; index < rows.length(); index += 1) {
                        JSONObject row = rows.getJSONObject(index);
                        String name = row.optString("name", "").trim();
                        if (name.isEmpty()) continue;
                        if (!loaded.contains(name)) loaded.add(name);
                        List<String> target = "income".equals(row.optString("kind", ""))
                                ? loadedIncome : loadedExpense;
                        if (!target.contains(name)) target.add(name);
                    }
                    if (loaded.isEmpty()) return;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            categoryOptions.clear();
                            categoryOptions.addAll(loaded);
                            if (!loadedExpense.isEmpty()) {
                                expenseCategoryOptions.clear();
                                expenseCategoryOptions.addAll(loadedExpense);
                            }
                            if (!loadedIncome.isEmpty()) {
                                incomeCategoryOptions.clear();
                                incomeCategoryOptions.addAll(loadedIncome);
                            }
                            if (!containsIgnoreCase(expenseCategoryOptions, "Other")) {
                                expenseCategoryOptions.add("Other");
                            }
                            if (!containsIgnoreCase(incomeCategoryOptions, "Other")) {
                                incomeCategoryOptions.add("Other");
                            }
                            renderScreen();
                        }
                    });
                } catch (Exception error) {
                    // Offline or no categories table yet: keep the built-in defaults.
                }
            }
        });
    }

    private void ensureCategoryOption(String value) {
        if (value == null || value.trim().isEmpty()) return;
        String name = value.trim();
        if (!categoryOptions.contains(name)) categoryOptions.add(name);
    }

    private Spinner categorySpinner(String selected) {
        ensureCategoryOption(selected);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_1, categoryOptions);
        Spinner view = new Spinner(this);
        view.setAdapter(adapter);
        String value = selected == null ? "" : selected.trim();
        int position = categoryOptions.indexOf(value);
        view.setSelection(position >= 0 ? position : 0);
        return withTopMargin(view, dp(8));
    }

    private String accountLabel(String id) {
        for (AccountOption option : accountOptions) {
            if (option.id.equals(id)) return option.name;
        }
        return id;
    }

    private void ensureAccountOption(String id) {
        if (id == null || id.isEmpty()) return;
        for (AccountOption option : accountOptions) {
            if (option.id.equals(id)) return;
        }
        accountOptions.add(new AccountOption(id, id));
    }

    private Spinner accountSpinner(String selected) {
        ensureAccountOption(selected);
        final List<String> ids = new ArrayList<String>();
        for (AccountOption option : accountOptions) ids.add(option.id);

        Spinner view = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_1, ids) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                return accountTextView(accountLabel(getItem(position)));
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                return accountTextView(accountLabel(getItem(position)));
            }
        };
        view.setAdapter(adapter);
        int selection = ids.indexOf(selected);
        if (selection < 0) selection = ids.indexOf("bank");
        view.setSelection(Math.max(0, selection));
        return withTopMargin(view, dp(8));
    }

    private TextView accountTextView(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(16f);
        view.setPadding(dp(10), dp(8), dp(10), dp(8));
        return view;
    }

    private LinearLayout navRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return row;
    }

    private LinearLayout card() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setBackgroundColor(Color.rgb(245, 245, 245));
        view.setPadding(dp(12), dp(12), dp(12), dp(12));
        return withTopMargin(view, dp(12));
    }

    private Spinner stringSpinner(String[] values, String selected) {
        Spinner view = new Spinner(this);
        setSpinnerItems(view, java.util.Arrays.asList(values), selected);
        return withTopMargin(view, dp(8));
    }

    private void setSpinnerItems(Spinner spinner, List<String> values, String selected) {
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this,
                android.R.layout.simple_list_item_1, values);
        spinner.setAdapter(adapter);
        int position = values.indexOf(selected);
        spinner.setSelection(position >= 0 ? position : 0);
    }

    private List<String> categoryNamesFor(String kind) {
        List<String> names = new ArrayList<String>(("income".equals(kind)
                ? incomeCategoryOptions : expenseCategoryOptions));
        if (!containsIgnoreCase(names, "Other")) names.add("Other");
        return names;
    }

    private static boolean containsIgnoreCase(List<String> values, String target) {
        if (target == null) return false;
        for (String value : values) {
            if (value != null && value.equalsIgnoreCase(target.trim())) return true;
        }
        return false;
    }

    private static String valueOr(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static List<CashFlowRow> cashFlowRowsFrom(JSONArray rows) throws JSONException {
        List<CashFlowRow> result = new ArrayList<CashFlowRow>();
        for (int index = 0; index < rows.length(); index += 1) {
            JSONObject row = rows.getJSONObject(index);
            CashFlowRow flow = new CashFlowRow();
            flow.id = row.optString("id", "");
            flow.kind = "income".equals(row.optString("kind", "")) ? "income" : "expense";
            flow.name = valueOr(row.optString("name", ""), flow.id.isEmpty() ? "Cash flow" : flow.id);
            flow.amount = Math.abs(row.optDouble("amount", 0));
            flow.category = valueOr(row.optString("category", ""), "Other");
            flow.account = valueOr(row.optString("account", ""), "bank");
            flow.recurrence = valueOr(row.optString("recurrence", ""), "monthly");
            flow.intervalCount = Math.max(1, row.optInt("interval_count", 1));
            flow.startDate = row.optString("start_date", "");
            flow.source = valueOr(row.optString("source", ""), "manual");
            result.add(flow);
        }
        return result;
    }

    private static boolean occursInMonth(CashFlowRow flow, YearMonth month) {
        if (flow.startDate == null || flow.startDate.trim().isEmpty()) return false;
        LocalDate start;
        try {
            start = LocalDate.parse(flow.startDate.trim());
        } catch (Exception error) {
            return false;
        }
        YearMonth startMonth = YearMonth.from(start);
        if (startMonth.isAfter(month)) return false;
        if ("one_time".equals(flow.recurrence)) return startMonth.equals(month);
        if ("monthly".equals(flow.recurrence)) return true;
        if ("yearly".equals(flow.recurrence)) return start.getMonthValue() == month.getMonthValue();
        if ("every_n_months".equals(flow.recurrence)) {
            int between = (month.getYear() - startMonth.getYear()) * 12
                    + (month.getMonthValue() - startMonth.getMonthValue());
            int every = Math.max(1, flow.intervalCount);
            return between >= 0 && between % every == 0;
        }
        if ("every_n_years".equals(flow.recurrence)) {
            int between = month.getYear() - startMonth.getYear();
            int every = Math.max(1, flow.intervalCount);
            return start.getMonthValue() == month.getMonthValue()
                    && between >= 0 && between % every == 0;
        }
        return false;
    }

    private static String money(double amount) {
        return String.format(Locale.US, "%,.2f", amount);
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
        return "Signed in as " + api.getEmail() + "\nLast scan: " + when
                + "\nScans are limited to the current month.";
    }

    private static long startOfCurrentMonthMillis() {
        Calendar calendar = Calendar.getInstance();
        calendar.set(Calendar.DAY_OF_MONTH, 1);
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        return calendar.getTimeInMillis();
    }

    private static String dateOf(long timestampMillis) {
        long safeTimestamp = timestampMillis > 0 ? timestampMillis : System.currentTimeMillis();
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(safeTimestamp));
    }

    private static String dateTimeOf(long timestampMillis) {
        long safeTimestamp = timestampMillis > 0 ? timestampMillis : System.currentTimeMillis();
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(safeTimestamp));
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
