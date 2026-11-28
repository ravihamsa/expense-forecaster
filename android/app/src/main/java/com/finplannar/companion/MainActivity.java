package com.finplannar.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.ContentResolver;
import android.content.DialogInterface;
import android.content.pm.PackageManager;
import android.content.res.TypedArray;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.Window;
import android.widget.GridLayout;
import android.widget.TextView.OnEditorActionListener;
import android.view.inputmethod.EditorInfo;
import android.widget.AdapterView;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
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
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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

    // Same palette as the web app's styles.css, kept in Java because this UI is code-only.
    private static final int COLOR_BG = Color.parseColor("#070F16");
    private static final int COLOR_SURFACE = Color.parseColor("#142330");
    private static final int COLOR_SURFACE_2 = Color.parseColor("#182A38");
    private static final int COLOR_SURFACE_3 = Color.parseColor("#1D3445");
    private static final int COLOR_BORDER = Color.parseColor("#223442");
    private static final int COLOR_TEXT = Color.parseColor("#E7F0F5");
    private static final int COLOR_MUTED = Color.parseColor("#8CA0AE");
    private static final int COLOR_TEAL = Color.parseColor("#2DD4A7");
    private static final int COLOR_RED = Color.parseColor("#FF6B6B");
    private static final int COLOR_AMBER = Color.parseColor("#FFBF69");
    private static final int COLOR_DARK_TEXT = Color.parseColor("#041A14");

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

    private enum Screen { SCAN, DASHBOARD, CASH_FLOWS, CATEGORIES, MONTH_VIEW, IGNORED, READY }

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

    private static final class RecentPlanEntry {
        final String name;
        final String kind;
        final double amount;
        final String date;
        final String fixedMonth;

        RecentPlanEntry(String name, String kind, double amount, String date, String fixedMonth) {
            this.name = name;
            this.kind = kind;
            this.amount = amount;
            this.date = date;
            this.fixedMonth = fixedMonth;
        }
    }

    private CompanionDb db;
    private SupabaseApi api;
    private ExecutorService executor;
    private ScrollView scrollView;
    private LinearLayout content;
    private LinearLayout bottomNav;
    private Button scanButton;
    private boolean scanning;
    private String selectedMonthDate = "";
    private String ignoredQuery = "";
    private String smsQuery = "";
    private int smsVisibleLimit = VISIBLE_CANDIDATE_LIMIT;
    private String monthFilter = "all";
    private final Map<String, Double> cashFlowOverrides = new HashMap<>();
    private final List<RecentPlanEntry> recentPlanEntries = new ArrayList<>();
    private long lastBackPress;
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
    private YearMonth monthViewMonth = YearMonth.now();
    private String monthViewStatus = "Loading month…";
    private final List<MonthEvent> monthEvents = new ArrayList<>();
    private double monthPlannedIncome;
    private double monthPlannedExpense;
    private double monthRecordedIncome;
    private double monthRecordedExpense;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.setStatusBarColor(COLOR_BG);
            window.setNavigationBarColor(COLOR_BG);
        }
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

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(COLOR_BG);

        scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setBackgroundColor(COLOR_BG);
        content.setPadding(dp(16), dp(18), dp(16), dp(28));
        scrollView.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scrollView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        View navDivider = new View(this);
        navDivider.setBackgroundColor(COLOR_BORDER);
        root.addView(navDivider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        bottomNav = new LinearLayout(this);
        bottomNav.setOrientation(LinearLayout.HORIZONTAL);
        bottomNav.setBackgroundColor(COLOR_SURFACE);
        // Keep the tabs clear of the system gesture/navigation area.
        bottomNav.setPadding(0, dp(4), 0, dp(20));
        root.addView(bottomNav, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(88)));
        setContentView(root);

        if (savedInstanceState != null) {
            String savedScreen = savedInstanceState.getString("screen");
            if (savedScreen != null) {
                try {
                    screen = Screen.valueOf(savedScreen);
                } catch (IllegalArgumentException ignored) {
                    screen = Screen.SCAN;
                }
            }
            String savedMonth = savedInstanceState.getString("month");
            if (savedMonth != null) {
                try {
                    monthViewMonth = YearMonth.parse(savedMonth);
                } catch (Exception ignored) {
                    monthViewMonth = YearMonth.now();
                }
            }
            selectedMonthDate = valueOr(savedInstanceState.getString("selectedDay"), "");
            ignoredQuery = valueOr(savedInstanceState.getString("ignoredQuery"), "");
            smsQuery = valueOr(savedInstanceState.getString("smsQuery"), "");
            smsVisibleLimit = savedInstanceState.getInt("smsLimit", VISIBLE_CANDIDATE_LIMIT);
            monthFilter = valueOr(savedInstanceState.getString("monthFilter"), "all");
        }

        renderScreen();
        loadAccounts();
        loadCategories();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putString("screen", screen.name());
        outState.putString("month", monthViewMonth.toString());
        outState.putString("selectedDay", selectedMonthDate);
        outState.putString("ignoredQuery", ignoredQuery);
        outState.putString("smsQuery", smsQuery);
        outState.putInt("smsLimit", smsVisibleLimit);
        outState.putString("monthFilter", monthFilter);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (screen == Screen.SCAN) {
            if (SystemClock.elapsedRealtime() - lastBackPress < 2000) {
                super.onBackPressed();
                return;
            }
            lastBackPress = SystemClock.elapsedRealtime();
            toast("Tap back again to exit");
            return;
        }
        goTo(Screen.SCAN);
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
        final int scrollY = scrollView == null ? 0 : scrollView.getScrollY();
        statusView = null;
        summaryView = null;
        content.removeAllViews();
        if (!api.isSignedIn()) {
            bottomNav.setVisibility(View.GONE);
            renderAuthScreen();
            return;
        }
        bottomNav.setVisibility(View.VISIBLE);
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
            case MONTH_VIEW:
                renderMonthViewScreen();
                break;
            case IGNORED:
                renderIgnoredScreen();
                break;
            case READY:
                renderReadyScreen();
                break;
            default:
                renderMainScreen();
                break;
        }
        renderBottomNav();
        final int restoreY = scrollY;
        scrollView.post(new Runnable() {
            @Override
            public void run() {
                scrollView.scrollTo(0, restoreY);
            }
        });
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
        content.addView(heading("SMS review"));
        statusView = note(scanning ? "Scanning current-month SMS…" : statusText());
        content.addView(statusView);

        LinearLayout actions = navRow();
        scanButton = button(scanning ? "Scanning…" : "Scan SMS", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                onScanClicked();
            }
        });
        LinearLayout.LayoutParams scanParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        scanParams.topMargin = dp(12);
        scanParams.rightMargin = dp(5);
        scanButton.setLayoutParams(scanParams);
        scanButton.setEnabled(!scanning);
        actions.addView(scanButton);

        View save = button("Save selected", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                onSaveSelectedClicked();
            }
        });
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        saveParams.topMargin = dp(12);
        saveParams.leftMargin = dp(5);
        save.setLayoutParams(saveParams);
        actions.addView(save);
        content.addView(actions);

        LinearLayout tools = navRow();
        tools.addView(choiceButton("Review ready", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goTo(Screen.READY);
            }
        }));
        tools.addView(choiceButton("More ▾", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showSmsMenu(view);
            }
        }));
        content.addView(tools);

        final long monthStart = startOfCurrentMonthMillis();
        summaryView = note("");
        updateSummary(monthStart);
        content.addView(summaryView);

        EditText search = textField("Search sender or message", smsQuery);
        search.setSingleLine(true);
        search.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        search.setOnEditorActionListener(new OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView view, int actionId, android.view.KeyEvent event) {
                boolean enterPressed = event != null
                        && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER;
                if (actionId == EditorInfo.IME_ACTION_SEARCH
                        || actionId == EditorInfo.IME_ACTION_DONE
                        || (actionId == EditorInfo.IME_ACTION_UNSPECIFIED && enterPressed)) {
                    smsQuery = view.getText().toString();
                    smsVisibleLimit = VISIBLE_CANDIDATE_LIMIT;
                    scrollView.scrollTo(0, 0);
                    renderScreen();
                    return true;
                }
                return false;
            }
        });
        content.addView(search);

        List<Candidate> matching = filterCandidates(db.pendingCandidates(monthStart, 0), smsQuery);
        int matchingCount = matching.size();
        content.addView(sectionTitle("To review (" + matchingCount + ")"));
        if (matching.isEmpty()) {
            content.addView(note(smsQuery.trim().isEmpty()
                    ? "No current-month messages need review. Tap Scan SMS to find more."
                    : "No messages match this search."));
            return;
        }
        int visible = Math.min(smsVisibleLimit, matchingCount);
        for (Candidate candidate : matching.subList(0, visible)) {
            addCandidateCard(content, candidate);
        }
        if (matchingCount > visible) {
            final int remaining = matchingCount - visible;
            content.addView(button("Load more (" + remaining + ")", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    smsVisibleLimit += VISIBLE_CANDIDATE_LIMIT;
                    renderScreen();
                }
            }));
        }
    }

    private void showSmsMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add("Vendor rules");
        menu.getMenu().add("Export CSV");
        menu.getMenu().add("Sign out");
        menu.setOnMenuItemClickListener(new PopupMenu.OnMenuItemClickListener() {
            @Override
            public boolean onMenuItemClick(android.view.MenuItem item) {
                String title = String.valueOf(item.getTitle());
                if ("Vendor rules".equals(title)) {
                    showVendorRules();
                } else if ("Export CSV".equals(title)) {
                    onExportCsvClicked();
                } else if ("Sign out".equals(title)) {
                    confirmSignOut();
                }
                return true;
            }
        });
        menu.show();
    }

    private void confirmSignOut() {
        new AlertDialog.Builder(this)
                .setTitle("Sign out?")
                .setMessage("Confirmed messages that were not saved stay on this phone. "
                        + "You can sign in again without losing them.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Sign out", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        api.signOut();
                        screen = Screen.SCAN;
                        scrollView.scrollTo(0, 0);
                        renderScreen();
                        toast("Signed out");
                    }
                })
                .show();
    }

    private static List<Candidate> filterCandidates(List<Candidate> rows, String query) {
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.getDefault());
        if (needle.isEmpty()) return rows;
        List<Candidate> result = new ArrayList<>();
        for (Candidate candidate : rows) {
            String haystack = candidate.sender + " " + candidate.body + " " + candidate.name + " "
                    + candidate.merchant + " " + candidate.category + " " + candidate.amount;
            if (haystack.toLowerCase(Locale.getDefault()).contains(needle)) result.add(candidate);
        }
        return result;
    }

    private void renderMonthViewScreen() {
        content.addView(heading("Month view"));
        content.addView(note(monthViewStatus));

        LinearLayout controls = navRow();
        controls.addView(choiceButton("‹ Previous", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                shiftMonth(-1);
            }
        }));
        controls.addView(choiceButton("This month", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                monthViewMonth = YearMonth.now();
                selectedMonthDate = "";
                loadMonthView();
                renderScreen();
            }
        }));
        controls.addView(choiceButton("Next ›", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                shiftMonth(1);
            }
        }));
        content.addView(controls);

        LinearLayout filters = navRow();
        filters.addView(choiceButton("All", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                setMonthFilter("all");
            }
        }));
        filters.addView(choiceButton("Planned", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                setMonthFilter("planned");
            }
        }));
        filters.addView(choiceButton("Recorded", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                setMonthFilter("recorded");
            }
        }));
        content.addView(filters);

        LinearLayout plannedStats = navRow();
        plannedStats.addView(statCard("Planned income", "+" + money(monthPlannedIncome), COLOR_TEAL));
        plannedStats.addView(statCard("Planned spend", "-" + money(monthPlannedExpense), COLOR_AMBER));
        content.addView(plannedStats);
        LinearLayout recordedStats = navRow();
        recordedStats.addView(statCard("Recorded income", "+" + money(monthRecordedIncome), COLOR_TEAL));
        recordedStats.addView(statCard("Recorded spend", "-" + money(monthRecordedExpense), COLOR_RED));
        content.addView(recordedStats);

        String label = monthViewMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()));
        content.addView(sectionTitle(label));
        content.addView(buildMonthGrid());

        content.addView(sectionTitle(selectedMonthDate.isEmpty()
                ? "Day details" : longDateOf(selectedMonthDate)));
        List<MonthEvent> dayEvents = eventsOn(selectedMonthDate);
        if (dayEvents.isEmpty()) {
            content.addView(note(selectedMonthDate.isEmpty()
                    ? "Tap a day in the calendar to see its planned and recorded entries."
                    : "Nothing planned or recorded on this day."));
        } else {
            for (final MonthEvent event : dayEvents) {
                LinearLayout card = card();
                TextView title = new TextView(this);
                title.setText(("income".equals(event.kind) ? "↑ " : "↓ ")
                        + event.title + "  •  " + money(event.amount));
                title.setTextSize(16f);
                title.setTypeface(Typeface.DEFAULT_BOLD);
                title.setTextColor("income".equals(event.kind) ? COLOR_TEAL
                        : event.planned ? COLOR_AMBER : COLOR_RED);
                card.addView(title);
                card.addView(note(event.detail));
                if (!"income".equals(event.kind) && !event.refId.isEmpty()) {
                    card.addView(button(event.planned ? "Edit planned category" : "Edit recorded category",
                            new View.OnClickListener() {
                                @Override
                                public void onClick(View view) {
                                    showMonthEventEditor(event);
                                }
                            }));
                }
                content.addView(card);
            }
        }

        content.addView(button("Refresh month", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                loadMonthView();
                renderScreen();
            }
        }));
    }

    private void shiftMonth(int delta) {
        monthViewMonth = monthViewMonth.plusMonths(delta);
        selectedMonthDate = "";
        loadMonthView();
        renderScreen();
    }

    private void setMonthFilter(String filter) {
        monthFilter = filter;
        selectedMonthDate = "";
        renderScreen();
    }

    private boolean matchesMonthFilter(MonthEvent event) {
        if ("planned".equals(monthFilter)) return event.planned;
        if ("recorded".equals(monthFilter)) return !event.planned;
        return true;
    }

    private List<MonthEvent> eventsOn(String date) {
        List<MonthEvent> result = new ArrayList<>();
        if (date == null || date.isEmpty()) return result;
        for (MonthEvent event : monthEvents) {
            if (date.equals(event.date) && matchesMonthFilter(event)) result.add(event);
        }
        return result;
    }

    private GridLayout buildMonthGrid() {
        GridLayout grid = new GridLayout(this);
        grid.setColumnCount(7);
        grid.setBackground(roundedBackground(COLOR_SURFACE, COLOR_BORDER));
        grid.setPadding(dp(4), dp(4), dp(4), dp(4));

        String[] weekdays = {"M", "T", "W", "T", "F", "S", "S"};
        for (int column = 0; column < 7; column += 1) {
            TextView header = new TextView(this);
            header.setText(weekdays[column]);
            header.setTextColor(COLOR_MUTED);
            header.setTextSize(11f);
            header.setTypeface(Typeface.DEFAULT_BOLD);
            header.setGravity(android.view.Gravity.CENTER);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(
                    GridLayout.spec(0), GridLayout.spec(column, 1f));
            params.width = 0;
            params.height = dp(26);
            grid.addView(header, params);
        }

        int offset = (monthViewMonth.atDay(1).getDayOfWeek().getValue() + 6) % 7;
        int total = offset + monthViewMonth.lengthOfMonth();
        int cells = ((total + 6) / 7) * 7;
        String today = LocalDate.now().toString();
        for (int index = 0; index < cells; index += 1) {
            LocalDate date = monthViewMonth.atDay(1).plusDays(index - offset);
            String key = date.toString();
            List<MonthEvent> dayEvents = eventsOn(key);
            boolean inMonth = date.getMonthValue() == monthViewMonth.getMonthValue();
            boolean selected = key.equals(selectedMonthDate);

            LinearLayout cell = new LinearLayout(this);
            cell.setOrientation(LinearLayout.VERTICAL);
            cell.setBackground(roundedBackground(
                    selected ? COLOR_SURFACE_3 : inMonth ? COLOR_SURFACE_2 : COLOR_BG,
                    selected ? COLOR_TEAL : COLOR_BORDER));
            cell.setPadding(dp(6), dp(6), dp(6), dp(6));
            cell.setMinimumHeight(dp(88));

            TextView dayNumber = new TextView(this);
            dayNumber.setText(String.valueOf(date.getDayOfMonth()));
            dayNumber.setTextSize(12.5f);
            dayNumber.setTypeface(Typeface.DEFAULT_BOLD);
            dayNumber.setTextColor(key.equals(today) ? COLOR_TEAL
                    : inMonth ? COLOR_TEXT : COLOR_MUTED);
            cell.addView(dayNumber);

            for (int eventIndex = 0; eventIndex < Math.min(3, dayEvents.size()); eventIndex += 1) {
                MonthEvent event = dayEvents.get(eventIndex);
                TextView chip = new TextView(this);
                String shortTitle = event.title.length() > 15
                        ? event.title.substring(0, 14) + "…" : event.title;
                chip.setText(("income".equals(event.kind) ? "↑ " : "↓ ") + shortTitle);
                chip.setTextSize(11f);
                chip.setTextColor("income".equals(event.kind) ? COLOR_TEAL
                        : event.planned ? COLOR_AMBER : COLOR_RED);
                cell.addView(chip);
            }
            if (dayEvents.size() > 3) {
                TextView more = new TextView(this);
                more.setText("+" + (dayEvents.size() - 3) + " more");
                more.setTextSize(10f);
                more.setTextColor(COLOR_MUTED);
                cell.addView(more);
            }

            final String dateKey = key;
            cell.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    selectedMonthDate = dateKey;
                    renderScreen();
                }
            });
            GridLayout.LayoutParams params = new GridLayout.LayoutParams(
                    GridLayout.spec(1 + index / 7), GridLayout.spec(index % 7, 1f));
            params.width = 0;
            params.height = dp(94);
            params.setMargins(dp(2), dp(2), dp(2), dp(2));
            grid.addView(cell, params);
        }
        return grid;
    }

    private void showMonthEventEditor(final MonthEvent event) {
        final boolean planned = event.planned;
        final AlertDialog[] holder = new AlertDialog[1];
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);

        final EditText name = textField("Name", event.title);
        form.addView(name);
        final EditText amount = textField("Amount (₹)", String.format(Locale.US, "%.2f", event.amount));
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        form.addView(amount);

        form.addView(note("Category"));
        List<String> names = categoryNamesFor("expense");
        if (!containsIgnoreCase(names, event.category)) names.add(event.category);
        final Spinner category = stringSpinner(names.toArray(new String[0]), event.category);
        form.addView(category);

        if (planned && !event.occurrenceDate.isEmpty()) {
            form.addView(button("Move planned date", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    showMoveDatePicker(event, holder[0]);
                }
            }));
        }

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle(planned ? "Edit planned spend" : "Edit recorded spend")
                .setView(form)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", null)
                .create();
        holder[0] = dialog;
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                styleDialogButtons(holder[0]);
                holder[0].getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(
                        new View.OnClickListener() {
                            @Override
                            public void onClick(View view) {
                                double value = parseAmount(amount.getText().toString());
                                if (value <= 0) {
                                    toast("Enter a valid amount");
                                    return;
                                }
                                JSONObject payload = new JSONObject();
                                try {
                                    payload.put("category", String.valueOf(category.getSelectedItem()));
                                    payload.put("name", name.getText().toString().trim());
                                    payload.put(planned ? "monthly_limit" : "amount", value);
                                } catch (JSONException error) {
                                    toast("Could not build the edit: " + message(error));
                                    return;
                                }
                                holder[0].getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                                executor.execute(new Runnable() {
                                    @Override
                                    public void run() {
                                        try {
                                            String userId = api.getUserId();
                                            if (planned) {
                                                api.updateBudget(userId, event.refId, payload);
                                            } else {
                                                api.updateActual(userId, event.refId, payload);
                                            }
                                            runOnUiThread(new Runnable() {
                                                @Override
                                                public void run() {
                                                    holder[0].dismiss();
                                                    toast("Expense updated");
                                                    loadMonthView();
                                                    renderScreen();
                                                }
                                            });
                                        } catch (final Exception error) {
                                            runOnUiThread(new Runnable() {
                                                @Override
                                                public void run() {
                                                    holder[0].getButton(AlertDialog.BUTTON_POSITIVE)
                                                            .setEnabled(true);
                                                    toast("Could not update expense: " + message(error));
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

    private void showMoveDatePicker(final MonthEvent event, final AlertDialog editor) {
        LocalDate current = LocalDate.parse(event.date);
        DatePickerDialog picker = new DatePickerDialog(this,
                new DatePickerDialog.OnDateSetListener() {
                    @Override
                    public void onDateSet(android.widget.DatePicker view, int year,
                                          int month, int dayOfMonth) {
                        final String target = String.format(Locale.US, "%04d-%02d-%02d",
                                year, month + 1, dayOfMonth);
                        if (target.equals(event.date)) return;
                        executor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    api.upsertBudgetMove(api.getUserId(), event.refId,
                                            event.occurrenceDate, target);
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (editor != null && editor.isShowing()) editor.dismiss();
                                            toast("Planned date moved");
                                            loadMonthView();
                                            renderScreen();
                                        }
                                    });
                                } catch (final Exception error) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            toast("Could not move planned date: " + message(error));
                                        }
                                    });
                                }
                            }
                        });
                    }
                }, current.getYear(), current.getMonthValue() - 1, current.getDayOfMonth());
        picker.setTitle("Move " + event.title);
        picker.show();
    }

    private void renderIgnoredScreen() {
        content.addView(heading("Ignored SMS"));
        content.addView(note("Dismissed by the on-device parser. Nothing here was sent to Supabase. "
                + "Un-ignore brings a message back to SMS review for confirmation."));

        EditText search = textField("Search sender or message", ignoredQuery);
        search.setSingleLine(true);
        search.setOnEditorActionListener(new OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView view, int actionId, android.view.KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEARCH || actionId == EditorInfo.IME_ACTION_DONE) {
                    ignoredQuery = view.getText().toString();
                    renderScreen();
                    return true;
                }
                return false;
            }
        });
        content.addView(search);
        if (!ignoredQuery.trim().isEmpty()) {
            content.addView(button("Clear search", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    ignoredQuery = "";
                    renderScreen();
                }
            }));
        }

        String query = ignoredQuery.trim().toLowerCase(Locale.getDefault());
        List<Candidate> all = db.ignoredCandidates(200);
        List<Candidate> ignored = new ArrayList<>();
        for (Candidate candidate : all) {
            if (query.isEmpty() || candidate.sender.toLowerCase(Locale.getDefault()).contains(query)
                    || candidate.body.toLowerCase(Locale.getDefault()).contains(query)) {
                ignored.add(candidate);
            }
        }
        content.addView(sectionTitle(ignored.size() + " ignored messages"));
        if (ignored.isEmpty()) {
            content.addView(note("No messages match this search."));
            return;
        }

        for (final Candidate candidate : ignored) {
            LinearLayout card = card();
            TextView header = new TextView(this);
            header.setText(candidate.sender + "  •  "
                    + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                    .format(new Date(candidate.smsDate)));
            header.setTextColor(COLOR_TEXT);
            header.setTextSize(15f);
            header.setTypeface(Typeface.DEFAULT_BOLD);
            card.addView(header);

            String snippet = candidate.body.replaceAll("\\s+", " ").trim();
            if (snippet.length() > 180) snippet = snippet.substring(0, 180) + "…";
            card.addView(note(snippet));
            card.addView(note("Amount " + (candidate.amount > 0 ? money(candidate.amount) : "not set")
                    + "  •  " + candidate.kind + "  •  " + candidate.category));
            if (candidate.synced) card.addView(badge("synced as ignored", COLOR_MUTED));
            card.addView(button("Un-ignore", new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    db.unignoreCandidate(candidate.fingerprint);
                    toast("Message returned to SMS review");
                    renderScreen();
                }
            }));
            content.addView(card);
        }
    }

    private void renderReadyScreen() {
        content.addView(heading("Ready to save"));
        content.addView(note("These messages are confirmed but nothing has been sent to Supabase yet. "
                + "Edit them, send one back to SMS review, or ignore it before tapping Save selected."));

        List<Candidate> ready = db.readyCandidates(startOfCurrentMonthMillis());
        if (ready.isEmpty()) {
            content.addView(note("Nothing is queued for Save selected yet."));
        } else {
            content.addView(note(ready.size() + " queued for this month."));
            for (Candidate candidate : ready) {
                addReadyCandidateCard(content, candidate);
            }
        }

        content.addView(button("Back to SMS review", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                screen = Screen.SCAN;
                renderScreen();
            }
        }));
    }

    // ------------------------------------------------------------ nav + dashboard

    private void renderBottomNav() {
        bottomNav.removeAllViews();
        long monthStart = startOfCurrentMonthMillis();
        int pending = db.countPending(monthStart);
        int ready = db.countReadyToSave(monthStart);
        int ignored = db.countIgnored();
        addTab("⌂", "Plan", Screen.DASHBOARD, "");
        addTab("✉", "SMS", Screen.SCAN, pending > 0 ? String.valueOf(pending) : "");
        addTab("✓", "Ready", Screen.READY, ready > 0 ? String.valueOf(ready) : "");
        addTab("▦", "Month", Screen.MONTH_VIEW, "");
        addTab("⊘", "Ignored", Screen.IGNORED, ignored > 0 ? String.valueOf(ignored) : "");
    }

    private void addTab(String icon, String label, Screen target) {
        addTab(icon, label, target, "");
    }

    private void addTab(String icon, String label, final Screen target, String count) {
        boolean active = screen == target
                || (target == Screen.DASHBOARD && (screen == Screen.CASH_FLOWS || screen == Screen.CATEGORIES));
        LinearLayout tab = new LinearLayout(this);
        tab.setOrientation(LinearLayout.VERTICAL);
        tab.setGravity(android.view.Gravity.CENTER);
        tab.setContentDescription(label);
        applyPressFeedback(tab);
        tab.setLayoutParams(new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        LinearLayout pill = new LinearLayout(this);
        pill.setOrientation(LinearLayout.VERTICAL);
        pill.setGravity(android.view.Gravity.CENTER);
        pill.setBackground(roundedBackground(active ? COLOR_SURFACE_3 : COLOR_SURFACE,
                active ? COLOR_TEAL : Color.TRANSPARENT));
        pill.setPadding(dp(12), dp(6), dp(12), dp(5));
        pill.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView iconView = new TextView(this);
        iconView.setText(icon);
        iconView.setTextSize(18f);
        iconView.setTextColor(active ? COLOR_TEAL : COLOR_MUTED);
        pill.addView(iconView);

        LinearLayout labelRow = new LinearLayout(this);
        labelRow.setOrientation(LinearLayout.HORIZONTAL);
        labelRow.setGravity(android.view.Gravity.CENTER);
        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextSize(10.5f);
        labelView.setTextColor(active ? COLOR_TEAL : COLOR_MUTED);
        labelView.setTypeface(active ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        labelRow.addView(labelView);

        if (!count.isEmpty()) {
            TextView badgeView = new TextView(this);
            badgeView.setText(count);
            badgeView.setTextSize(9f);
            badgeView.setTypeface(Typeface.DEFAULT_BOLD);
            badgeView.setTextColor(COLOR_DARK_TEXT);
            int badgeColor = target == Screen.READY ? COLOR_TEAL : COLOR_AMBER;
            badgeView.setBackground(roundedBackground(badgeColor, badgeColor));
            badgeView.setPadding(dp(5), dp(1), dp(5), dp(1));
            LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            badgeParams.leftMargin = dp(4);
            badgeView.setLayoutParams(badgeParams);
            labelRow.addView(badgeView);
        }
        pill.addView(labelRow);
        tab.addView(pill);

        tab.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goTo(target);
            }
        });
        bottomNav.addView(tab);
    }

    private void goTo(Screen target) {
        if (target == Screen.MONTH_VIEW && screen != Screen.MONTH_VIEW) {
            selectedMonthDate = "";
            loadMonthView();
        }
        if (target == Screen.DASHBOARD) {
            dashboardStatus = "Loading dashboard…";
            loadDashboard();
        }
        if (target == Screen.CASH_FLOWS) {
            loadCashFlows();
        }
        screen = target;
        scrollView.scrollTo(0, 0);
        renderScreen();
    }

    private void addPlanSubNav() {
        LinearLayout row = navRow();
        row.addView(choiceButton("Dashboard", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goTo(Screen.DASHBOARD);
            }
        }));
        row.addView(choiceButton("Cash flows", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goTo(Screen.CASH_FLOWS);
            }
        }));
        row.addView(choiceButton("Categories", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                goTo(Screen.CATEGORIES);
            }
        }));
        content.addView(row);
    }

    private void renderDashboardScreen() {
        YearMonth month = YearMonth.now();
        String monthLabel = month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()));
        content.addView(heading("Dashboard"));
        content.addView(note("Your plan at a glance · " + monthLabel));
        addPlanSubNav();
        statusView = statusPill(dashboardStatus);
        content.addView(statusView);

        double plannedNet = dashboardPlannedIncome - dashboardPlannedExpense;
        double actualNet = dashboardActualIncome - dashboardActualExpense;
        double projected = dashboardOpeningTotal + plannedNet;

        LinearLayout hero = card();
        hero.setBackground(roundedBackground(COLOR_SURFACE_3, COLOR_TEAL));
        TextView heroLabel = new TextView(this);
        heroLabel.setText("PROJECTED BALANCE");
        heroLabel.setTextColor(COLOR_TEAL);
        heroLabel.setTextSize(12f);
        heroLabel.setTypeface(Typeface.DEFAULT_BOLD);
        heroLabel.setAllCaps(true);
        hero.addView(heroLabel);

        TextView heroValue = new TextView(this);
        heroValue.setText(dashboardCurrency + " " + money(projected));
        heroValue.setTextColor(projected >= 0 ? COLOR_TEAL : COLOR_RED);
        heroValue.setTextSize(30f);
        heroValue.setTypeface(Typeface.DEFAULT_BOLD);
        hero.addView(withTopMargin(heroValue, dp(4)));

        TextView heroDetail = note("Opening " + dashboardCurrency + " "
                + money(dashboardOpeningTotal) + "  •  planned net "
                + signedMoney(plannedNet));
        hero.addView(heroDetail);
        content.addView(hero);

        LinearLayout plannedStats = navRow();
        plannedStats.addView(statCard("Planned income", "+" + money(dashboardPlannedIncome),
                COLOR_TEAL));
        plannedStats.addView(statCard("Planned spend", "-" + money(dashboardPlannedExpense),
                COLOR_AMBER));
        content.addView(plannedStats);

        LinearLayout recordedStats = navRow();
        recordedStats.addView(statCard("Recorded income", "+" + money(dashboardActualIncome),
                COLOR_TEAL));
        recordedStats.addView(statCard("Recorded spend", "-" + money(dashboardActualExpense),
                COLOR_RED));
        content.addView(recordedStats);

        content.addView(note("Planned net " + signedMoney(plannedNet)
                + "  •  Recorded net " + signedMoney(actualNet)));

        content.addView(sectionTitle("Accounts"));
        if (accountOptions.isEmpty()) {
            content.addView(note("No accounts yet. Add one from the web app."));
        } else {
            for (AccountOption account : accountOptions) {
                content.addView(accountRow(account));
            }
        }

        content.addView(sectionTitle("Recent planned entries"));
        if (recentPlanEntries.isEmpty()) {
            content.addView(note("No planned entries yet. Add one in Cash flows."));
        } else {
            for (RecentPlanEntry entry : recentPlanEntries) {
                content.addView(planEntryCard(entry));
            }
        }

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
                    String monthKey = month.toString();
                    String from = month.atDay(1).toString();
                    String to = month.atEndOfMonth().toString();

                    JSONArray profileRows = api.fetchProfile(userId);
                    JSONArray accountRows = api.fetchAccounts(userId);
                    JSONArray flowRows = api.fetchCashFlows(userId);
                    JSONArray incomeRows = api.fetchMonthlyIncomes(userId, monthKey);
                    JSONArray actualRows = api.fetchActuals(userId, from, to);
                    final Map<String, Double> loadedOverrides =
                            overridesFrom(api.fetchCashFlowOverrides(userId));

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
                    final List<RecentPlanEntry> recent = new ArrayList<RecentPlanEntry>();
                    for (CashFlowRow flow : loadedFlows) {
                        String flowMonth = flow.startDate != null && flow.startDate.length() >= 7
                                ? flow.startDate.substring(0, 7) : monthKey;
                        String effectiveMonth = occursInMonth(flow, month) ? monthKey : flowMonth;
                        double shownAmount = cashFlowAmountFor(flow, effectiveMonth, loadedOverrides);
                        boolean fixed = loadedOverrides.containsKey(
                                cashFlowOverrideKey(flow.id, effectiveMonth));
                        if (occursInMonth(flow, month)) {
                            if ("income".equals(flow.kind)) {
                                plannedIncome[0] += shownAmount;
                            } else {
                                plannedExpense[0] += shownAmount;
                            }
                        }
                        if (recent.size() < 5) {
                            recent.add(new RecentPlanEntry(flow.name, flow.kind, shownAmount,
                                    flow.startDate, fixed ? effectiveMonth : ""));
                        }
                    }
                    for (int index = 0; index < incomeRows.length(); index += 1) {
                        JSONObject row = incomeRows.getJSONObject(index);
                        double amount = Math.abs(row.optDouble("amount", 0));
                        plannedIncome[0] += amount;
                        if (recent.size() < 5) {
                            recent.add(new RecentPlanEntry(
                                    valueOr(row.optString("note", ""), "Monthly income"),
                                    "income", amount, from, ""));
                        }
                    }
                    final List<RecentPlanEntry> finalRecent = recent;

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
                            cashFlowOverrides.clear();
                            cashFlowOverrides.putAll(loadedOverrides);
                            recentPlanEntries.clear();
                            recentPlanEntries.addAll(finalRecent);
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

    // ---------------------------------------------------------------- month view

    private void loadMonthView() {
        if (!api.isSignedIn()) return;
        final YearMonth month = monthViewMonth;
        monthViewStatus = "Loading month…";
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    String userId = api.getUserId();
                    String from = month.atDay(1).toString();
                    String to = month.atEndOfMonth().toString();
                    String monthKey = month.toString();
                    JSONArray budgetRows = api.fetchBudgets(userId);
                    JSONArray incomeRows = api.fetchMonthlyIncomes(userId, monthKey);
                    JSONArray flowRows = api.fetchCashFlows(userId);
                    JSONArray actualRows = api.fetchActuals(userId, from, to);
                    final Map<String, Double> loadedOverrides =
                            overridesFrom(api.fetchCashFlowOverrides(userId));
                    JSONArray moveRows;
                    try {
                        moveRows = api.fetchBudgetMoves(userId);
                    } catch (Exception missingTable) {
                        moveRows = new JSONArray();
                    }

                    Map<String, String> moves = new LinkedHashMap<>();
                    for (int index = 0; index < moveRows.length(); index += 1) {
                        JSONObject move = moveRows.getJSONObject(index);
                        moves.put(move.optString("budget_id", "") + "|"
                                + move.optString("from_date", ""), move.optString("to_date", ""));
                    }

                    Map<String, MonthEvent> events = new LinkedHashMap<>();
                    double plannedIncome = 0;
                    double plannedExpense = 0;
                    double recordedIncome = 0;
                    double recordedExpense = 0;

                    for (int index = 0; index < budgetRows.length(); index += 1) {
                        JSONObject row = budgetRows.getJSONObject(index);
                        String id = row.optString("id", "");
                        if (id.isEmpty()) continue;
                        String title = valueOr(row.optString("name", ""),
                                valueOr(row.optString("category", ""), "Planned spend"));
                        String category = valueOr(row.optString("category", ""), "Other");
                        double amount = Math.abs(row.optDouble("monthly_limit", 0));
                        String period = valueOr(row.optString("period", ""), "monthly");
                        String startDate = row.optString("start_date", "");
                        for (int offset = -1; offset <= 1; offset += 1) {
                            YearMonth occurrenceMonth = month.plusMonths(offset);
                            String occurrence = budgetOccurrenceDate(period, startDate, occurrenceMonth);
                            if (occurrence == null) continue;
                            String target = moves.get(id + "|" + occurrence);
                            String effective = target == null || target.isEmpty() ? occurrence : target;
                            if (!effective.startsWith(month.toString())) continue;
                            String detail = category + " · Planned"
                                    + (target == null ? "" : " · moved from " + longDateOf(occurrence));
                            String key = "budget-" + id + "-" + occurrence;
                            if (!events.containsKey(key)) {
                                MonthEvent event = new MonthEvent(effective, title, detail,
                                        "expense", true, amount);
                                event.refId = id;
                                event.occurrenceDate = occurrence;
                                event.category = category;
                                event.source = "budget";
                                events.put(key, event);
                            }
                        }
                    }

                    for (int index = 0; index < incomeRows.length(); index += 1) {
                        JSONObject row = incomeRows.getJSONObject(index);
                        int day = row.optInt("day", 1);
                        day = Math.max(1, Math.min(month.lengthOfMonth(), day));
                        String date = month.atDay(day).toString();
                        double amount = Math.abs(row.optDouble("amount", 0));
                        String note = valueOr(row.optString("note", ""), "Monthly income");
                        events.put("income-" + month.toString(), new MonthEvent(date, "Monthly income",
                                note, "income", true, amount));
                    }

                    List<CashFlowRow> flows = cashFlowRowsFrom(flowRows);
                    for (CashFlowRow flow : flows) {
                        if (!"income".equals(flow.kind) || !occursInMonth(flow, month)) continue;
                        String date = cashFlowDateInMonth(flow, month);
                        if (date == null) continue;
                        double effectiveAmount = cashFlowAmountFor(flow, monthKey, loadedOverrides);
                        boolean fixed = loadedOverrides.containsKey(
                                cashFlowOverrideKey(flow.id, monthKey));
                        events.put("flow-" + flow.id + "-" + date, new MonthEvent(date,
                                flow.name, valueOr(flow.category, "Other") + " · Planned"
                                        + (fixed ? " · split-adjusted" : ""),
                                "income", true, effectiveAmount));
                    }

                    for (int index = 0; index < actualRows.length(); index += 1) {
                        JSONObject row = actualRows.getJSONObject(index);
                        String date = row.optString("date", "");
                        if (!date.startsWith(month.toString())) continue;
                        String kind = "income".equals(row.optString("kind", "")) ? "income" : "expense";
                        double amount = Math.abs(row.optDouble("amount", 0));
                        String title = valueOr(row.optString("name", ""),
                                valueOr(row.optString("category", ""), "Recorded"));
                        String actualCategory = valueOr(row.optString("category", ""), "Other");
                        String source = valueOr(row.optString("source", ""), "manual");
                        String detail = actualCategory + " · Recorded"
                                + ("sms".equals(source) ? " · SMS" : "");
                        MonthEvent event = new MonthEvent(date, title, detail, kind, false, amount);
                        event.refId = row.optString("event_key", "");
                        event.category = actualCategory;
                        event.source = source;
                        events.put("actual-" + row.optString("event_key", String.valueOf(index)), event);
                    }

                    List<MonthEvent> sorted = new ArrayList<>(events.values());
                    Collections.sort(sorted, new Comparator<MonthEvent>() {
                        @Override
                        public int compare(MonthEvent left, MonthEvent right) {
                            int byDate = left.date.compareTo(right.date);
                            if (byDate != 0) return byDate;
                            if (left.planned != right.planned) return left.planned ? -1 : 1;
                            return left.title.compareTo(right.title);
                        }
                    });

                    for (MonthEvent event : sorted) {
                        if ("income".equals(event.kind)) {
                            if (event.planned) plannedIncome += event.amount;
                            else recordedIncome += event.amount;
                        } else {
                            if (event.planned) plannedExpense += event.amount;
                            else recordedExpense += event.amount;
                        }
                    }

                    final List<MonthEvent> finalEvents = sorted;
                    final double finalPlannedIncome = plannedIncome;
                    final double finalPlannedExpense = plannedExpense;
                    final double finalRecordedIncome = recordedIncome;
                    final double finalRecordedExpense = recordedExpense;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.MONTH_VIEW || !month.equals(monthViewMonth)) return;
                            cashFlowOverrides.clear();
                            cashFlowOverrides.putAll(loadedOverrides);
                            monthEvents.clear();
                            monthEvents.addAll(finalEvents);
                            monthPlannedIncome = finalPlannedIncome;
                            monthPlannedExpense = finalPlannedExpense;
                            monthRecordedIncome = finalRecordedIncome;
                            monthRecordedExpense = finalRecordedExpense;
                            monthViewStatus = "Updated " + dateTimeOf(System.currentTimeMillis());
                            renderScreen();
                        }
                    });
                } catch (final Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.MONTH_VIEW) return;
                            monthViewStatus = "Month view failed: " + message(error);
                            renderScreen();
                        }
                    });
                }
            }
        });
    }

    private static String budgetOccurrenceDate(String period, String startDate, YearMonth month) {
        if (startDate == null || startDate.trim().isEmpty() || "monthly".equals(period)) {
            return month.atDay(1).toString();
        }
        if (startDate.length() < 10) return null;
        int startYear;
        int startMonth;
        try {
            startYear = Integer.parseInt(startDate.substring(0, 4));
            startMonth = Integer.parseInt(startDate.substring(5, 7));
        } catch (Exception error) {
            return null;
        }
        if (startMonth != month.getMonthValue()) return null;
        if ("one_time".equals(period)) {
            return startYear == month.getYear() ? startDate.substring(0, 10) : null;
        }
        if (month.getYear() < startYear) return null;
        int day = 1;
        try {
            day = Integer.parseInt(startDate.substring(8, 10));
        } catch (Exception ignored) {
            day = 1;
        }
        return month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth()))).toString();
    }

    private static String cashFlowDateInMonth(CashFlowRow flow, YearMonth month) {
        if (flow.startDate == null || flow.startDate.trim().isEmpty()) return null;
        try {
            LocalDate start = LocalDate.parse(flow.startDate.trim());
            return month.atDay(Math.max(1, Math.min(start.getDayOfMonth(), month.lengthOfMonth()))).toString();
        } catch (Exception error) {
            return null;
        }
    }

    private static String longDateOf(String value) {
        try {
            return LocalDate.parse(value).format(
                    DateTimeFormatter.ofPattern("EEE, d MMM", Locale.getDefault()));
        } catch (Exception error) {
            return value;
        }
    }

    // ------------------------------------------------------------- cash flow CRUD

    private void renderCashFlowsScreen() {
        content.addView(heading("Cash flows"));
        addPlanSubNav();
        content.addView(note("Edit planned entries here. SMS imports keep their source tag."));
        LinearLayout headerActions = navRow();
        headerActions.addView(choiceButton("Add cash flow", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showCashFlowDialog(null);
            }
        }));
        headerActions.addView(choiceButton("Refresh", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                loadCashFlows();
            }
        }));
        content.addView(headerActions);

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
            String flowMonth = flow.startDate != null && flow.startDate.length() >= 7
                    ? flow.startDate.substring(0, 7) : "";
            double shownAmount = cashFlowAmountFor(flow, flowMonth, cashFlowOverrides);
            boolean adjusted = cashFlowOverrides.containsKey(cashFlowOverrideKey(flow.id, flowMonth));
            card.addView(note(flow.kind + " • " + money(shownAmount) + " • "
                    + flow.category + " • " + accountLabel(flow.account)
                    + (adjusted ? " • split-adjusted" : "")));
            card.addView(note("Schedule: " + flow.recurrence + " • from " + flow.startDate
                    + ("sms".equals(flow.source) ? " • SMS import" : "")));
            List<String> fixedMonths = new ArrayList<String>();
            for (Map.Entry<String, Double> entry : cashFlowOverrides.entrySet()) {
                if (entry.getKey().startsWith(flow.id + "|")) {
                    fixedMonths.add(entry.getKey().substring(flow.id.length() + 1)
                            + ": " + money(entry.getValue()));
                }
            }
            if (!fixedMonths.isEmpty()) {
                Collections.sort(fixedMonths);
                card.addView(note("Original schedule " + money(flow.amount)
                        + "; split-adjusted months: "
                        + android.text.TextUtils.join(", ", fixedMonths)));
            }
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
                    final String userId = api.getUserId();
                    final List<CashFlowRow> loaded = cashFlowRowsFrom(api.fetchCashFlows(userId));
                    final Map<String, Double> loadedOverrides =
                            overridesFrom(api.fetchCashFlowOverrides(userId));
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (screen != Screen.CASH_FLOWS) return;
                            cashFlowRows.clear();
                            cashFlowRows.addAll(loaded);
                            cashFlowOverrides.clear();
                            cashFlowOverrides.putAll(loadedOverrides);
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
                styleDialogButtons(dialogHolder[0]);
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
        AlertDialog dialog = new AlertDialog.Builder(this)
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
                .create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                styleDialogButtons(dialog);
            }
        });
        dialog.show();
    }

    // ------------------------------------------------------------------ categories

    private void renderCategoriesScreen() {
        content.addView(heading("Categories"));
        addPlanSubNav();
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
                styleDialogButtons(dialogHolder[0]);
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
        card.setBackgroundColor(COLOR_SURFACE);
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardParams.topMargin = dp(12);
        card.setLayoutParams(cardParams);

        String date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                .format(new Date(candidate.smsDate));
        TextView header = new TextView(this);
        header.setText(candidate.sender + "  •  " + date);
        header.setTextColor(COLOR_TEXT);
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

    /** A confirmed row can still be edited or returned to review before Save selected. */
    private void addReadyCandidateCard(LinearLayout parent, final Candidate candidate) {
        LinearLayout card = card();

        String date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                .format(new Date(candidate.smsDate));
        TextView header = new TextView(this);
        header.setText(candidate.sender + "  •  " + date);
        header.setTextColor(COLOR_TEXT);
        header.setTextSize(15f);
        header.setTypeface(Typeface.DEFAULT_BOLD);
        card.addView(header);

        String snippet = candidate.body.replaceAll("\\s+", " ").trim();
        if (snippet.length() > 160) snippet = snippet.substring(0, 160) + "…";
        card.addView(note(snippet));

        final EditText amount = textField("Amount (₹)", String.format(Locale.US,
                "%.2f", candidate.amount));
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        card.addView(amount);
        final EditText name = textField("Name", candidate.name);
        card.addView(name);

        card.addView(note("Kind"));
        final Spinner kind = stringSpinner(new String[]{"expense", "income"}, candidate.kind);
        card.addView(kind);
        card.addView(note("Category"));
        final Spinner category = categorySpinner(candidate.category);
        card.addView(category);
        card.addView(note("Account"));
        final Spinner account = accountSpinner(candidate.account);
        card.addView(account);

        LinearLayout actions = navRow();
        actions.addView(choiceButton("Save changes", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                double value = parseAmount(amount.getText().toString());
                if (value <= 0) {
                    toast("Enter a valid amount");
                    return;
                }
                db.updateCandidateChoice(candidate.fingerprint, value,
                        name.getText().toString(), String.valueOf(category.getSelectedItem()),
                        String.valueOf(account.getSelectedItem()), String.valueOf(kind.getSelectedItem()));
                toast("Updated locally. Tap Save selected on SMS review to sync.");
                renderScreen();
            }
        }));
        actions.addView(choiceButton("Back to review", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                db.returnToReview(candidate.fingerprint);
                toast("Returned to SMS review");
                renderScreen();
            }
        }));
        actions.addView(choiceButton("Ignore", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                db.markIgnored(candidate.fingerprint);
                toast("Moved to Ignored SMS");
                renderScreen();
            }
        }));
        card.addView(actions);
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
        if (scanning) return;
        final long monthStart = startOfCurrentMonthMillis();
        final long lastId = db.getLastScanId();
        final ContentResolver resolver = getContentResolver();
        scanning = true;
        renderScreen();
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
                            scanning = false;
                            renderScreen();
                            setStatus(result);
                            toast(result);
                        }
                    });
                } catch (final Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            scanning = false;
                            renderScreen();
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
        final int count = db.reviewedCandidates(startOfCurrentMonthMillis()).size();
        if (count == 0) {
            toast("Nothing is queued for Save selected yet");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Save selected")
                .setMessage("Send " + count + " confirmed messages to Supabase? "
                        + "Rows you ignored are only marked saved on this phone.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save " + count, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        performSaveSelected();
                    }
                })
                .show();
    }

    private void performSaveSelected() {
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
        final AlertDialog dialog = builder.setNegativeButton("Close", null).create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                styleDialogButtons(dialog);
            }
        });
        dialog.show();
    }

    private void confirmDeleteRule(final VendorRule rule) {
        AlertDialog dialog = new AlertDialog.Builder(this)
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
                .create();
        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dialogInterface) {
                styleDialogButtons(dialog);
            }
        });
        dialog.show();
    }

    // --------------------------------------------------------------- view helpers

    private TextView heading(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(24f);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        return withTopMargin(view, dp(2));
    }

    private TextView sectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(17f);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        return withTopMargin(view, dp(18));
    }

    private TextView note(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(COLOR_MUTED);
        view.setTextSize(14.5f);
        view.setLineSpacing(0f, 1.15f);
        return withTopMargin(view, dp(8));
    }

    private TextView badge(String text, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(COLOR_DARK_TEXT);
        view.setTextSize(12f);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setBackground(roundedBackground(color, color));
        view.setPadding(dp(9), dp(4), dp(9), dp(4));
        return withTopMargin(view, dp(6));
    }

    private TextView statusPill(String text) {
        TextView view = note(text);
        view.setTextSize(12f);
        view.setBackground(roundedBackground(COLOR_SURFACE_2, COLOR_BORDER));
        view.setPadding(dp(10), dp(6), dp(10), dp(6));
        return view;
    }

    private static String signedMoney(double amount) {
        return (amount >= 0 ? "+" : "-") + money(Math.abs(amount));
    }

    private LinearLayout accountRow(AccountOption account) {
        LinearLayout row = card();
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);

        TextView initial = new TextView(this);
        String name = account.name == null ? "" : account.name.trim();
        initial.setText(name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(Locale.getDefault()));
        initial.setTextColor(COLOR_TEAL);
        initial.setTextSize(16f);
        initial.setTypeface(Typeface.DEFAULT_BOLD);
        initial.setGravity(android.view.Gravity.CENTER);
        initial.setBackground(roundedBackground(COLOR_SURFACE_3, COLOR_BORDER));
        LinearLayout.LayoutParams initialParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        initialParams.rightMargin = dp(12);
        initial.setLayoutParams(initialParams);
        row.addView(initial);

        LinearLayout details = new LinearLayout(this);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView nameView = new TextView(this);
        nameView.setText(name.isEmpty() ? "Account" : name);
        nameView.setTextColor(COLOR_TEXT);
        nameView.setTextSize(15f);
        nameView.setTypeface(Typeface.DEFAULT_BOLD);
        nameView.setMaxLines(1);
        nameView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        details.addView(nameView);
        details.addView(note("Opening balance"));
        row.addView(details);

        TextView amount = new TextView(this);
        amount.setText(dashboardCurrency + " " + money(account.openingBalance));
        amount.setTextColor(COLOR_TEXT);
        amount.setTextSize(15f);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setGravity(android.view.Gravity.END);
        row.addView(amount);
        return row;
    }

    private LinearLayout planEntryCard(RecentPlanEntry entry) {
        LinearLayout row = card();
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(android.view.Gravity.CENTER_VERTICAL);
        boolean income = "income".equals(entry.kind);

        TextView arrow = new TextView(this);
        arrow.setText(income ? "↑" : "↓");
        arrow.setTextColor(income ? COLOR_TEAL : COLOR_AMBER);
        arrow.setTextSize(21f);
        arrow.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams arrowParams = new LinearLayout.LayoutParams(
                dp(30), ViewGroup.LayoutParams.WRAP_CONTENT);
        arrowParams.rightMargin = dp(4);
        arrow.setLayoutParams(arrowParams);
        row.addView(arrow);

        LinearLayout details = new LinearLayout(this);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setLayoutParams(new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView nameView = new TextView(this);
        nameView.setText(entry.name);
        nameView.setTextColor(COLOR_TEXT);
        nameView.setTextSize(15f);
        nameView.setTypeface(Typeface.DEFAULT_BOLD);
        nameView.setMaxLines(1);
        nameView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        details.addView(nameView);
        String meta = entry.kind + "  •  " + entry.date;
        if (!entry.fixedMonth.isEmpty()) meta += "  •  split-adjusted " + entry.fixedMonth;
        details.addView(note(meta));
        row.addView(details);

        TextView amount = new TextView(this);
        amount.setText(dashboardCurrency + " " + money(entry.amount));
        amount.setTextColor(income ? COLOR_TEAL : COLOR_AMBER);
        amount.setTextSize(15f);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setGravity(android.view.Gravity.END);
        row.addView(amount);
        return row;
    }

    private LinearLayout statCard(String label, String value, int color) {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setBackground(roundedBackground(COLOR_SURFACE, COLOR_BORDER));
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.topMargin = dp(10);
        params.leftMargin = dp(5);
        params.rightMargin = dp(5);
        view.setLayoutParams(params);

        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextColor(COLOR_MUTED);
        labelView.setTextSize(11.5f);
        view.addView(labelView);
        TextView valueView = new TextView(this);
        valueView.setText(value);
        valueView.setTextColor(color);
        valueView.setTextSize(17f);
        valueView.setTypeface(Typeface.DEFAULT_BOLD);
        view.addView(valueView);
        return view;
    }

    private EditText textField(String hint, String value) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setHintTextColor(COLOR_MUTED);
        view.setText(value == null ? "" : value);
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(16f);
        view.setBackground(roundedBackground(COLOR_SURFACE_2, COLOR_BORDER));
        view.setPadding(dp(14), dp(12), dp(14), dp(12));
        view.setMinHeight(dp(48));
        return withTopMargin(view, dp(8));
    }

    private Button button(String label, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextColor(COLOR_DARK_TEXT);
        view.setTextSize(15f);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setAllCaps(false);
        view.setBackground(roundedBackground(COLOR_TEAL, COLOR_TEAL));
        view.setPadding(dp(16), dp(12), dp(16), dp(12));
        view.setMinHeight(dp(48));
        view.setOnClickListener(listener);
        return withTopMargin(view, dp(12));
    }

    private Button choiceButton(String label, View.OnClickListener listener) {
        Button view = new Button(this);
        view.setText(label);
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(13.5f);
        view.setAllCaps(false);
        view.setBackground(roundedBackground(COLOR_SURFACE_3, COLOR_BORDER));
        view.setPadding(dp(10), dp(10), dp(10), dp(10));
        view.setMinHeight(dp(46));
        view.setOnClickListener(listener);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.topMargin = dp(8);
        params.leftMargin = dp(5);
        view.setLayoutParams(params);
        return view;
    }

    private void applyPressFeedback(View view) {
        int[] attributes = {android.R.attr.selectableItemBackground};
        TypedArray styled = obtainStyledAttributes(attributes);
        Drawable foreground = styled.getDrawable(0);
        styled.recycle();
        view.setForeground(foreground);
    }

    private GradientDrawable roundedBackground(int fill, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setCornerRadius(dp(12));
        drawable.setColor(fill);
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private void styleDialogButtons(AlertDialog dialog) {
        styleDialogButton(dialog.getButton(AlertDialog.BUTTON_POSITIVE), true);
        styleDialogButton(dialog.getButton(AlertDialog.BUTTON_NEGATIVE), false);
        styleDialogButton(dialog.getButton(AlertDialog.BUTTON_NEUTRAL), false);
    }

    private void styleDialogButton(Button button, boolean primary) {
        if (button == null) return;
        button.setTextColor(primary ? COLOR_DARK_TEXT : COLOR_TEXT);
        button.setBackground(roundedBackground(primary ? COLOR_TEAL : COLOR_SURFACE_3,
                primary ? COLOR_TEAL : COLOR_BORDER));
        button.setAllCaps(false);
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
        ArrayAdapter<String> adapter = themedAdapter(categoryOptions);
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
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(15f);
        view.setBackground(roundedBackground(COLOR_SURFACE_2, COLOR_BORDER));
        view.setPadding(dp(12), dp(11), dp(12), dp(11));
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
        view.setBackground(roundedBackground(COLOR_SURFACE, COLOR_BORDER));
        view.setPadding(dp(16), dp(14), dp(16), dp(14));
        return withTopMargin(view, dp(12));
    }

    private Spinner stringSpinner(String[] values, String selected) {
        Spinner view = new Spinner(this);
        setSpinnerItems(view, java.util.Arrays.asList(values), selected);
        return withTopMargin(view, dp(8));
    }

    private void setSpinnerItems(Spinner spinner, List<String> values, String selected) {
        spinner.setAdapter(themedAdapter(values));
        int position = values.indexOf(selected);
        spinner.setSelection(position >= 0 ? position : 0);
    }

    /** Spinner rows use the same surface colours as the rest of the companion. */
    private ArrayAdapter<String> themedAdapter(List<String> values) {
        return new ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, values) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                return spinnerTextView(getItem(position));
            }

            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                return spinnerTextView(getItem(position));
            }
        };
    }

    private TextView spinnerTextView(String value) {
        TextView view = new TextView(this);
        view.setText(value == null ? "" : value);
        view.setTextColor(COLOR_TEXT);
        view.setTextSize(15f);
        view.setBackground(roundedBackground(COLOR_SURFACE_2, COLOR_BORDER));
        view.setPadding(dp(12), dp(11), dp(12), dp(11));
        return view;
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

    private static String cashFlowOverrideKey(String flowId, String month) {
        return flowId + "|" + month;
    }

    /** Calendar splits store a fixed amount for one month; honor it everywhere. */
    private static double cashFlowAmountFor(CashFlowRow flow, String month,
                                            Map<String, Double> overrides) {
        Double fixed = overrides.get(cashFlowOverrideKey(flow.id, month));
        return fixed == null ? flow.amount : fixed;
    }

    private static Map<String, Double> overridesFrom(JSONArray rows) throws JSONException {
        Map<String, Double> result = new HashMap<>();
        for (int index = 0; index < rows.length(); index += 1) {
            JSONObject row = rows.getJSONObject(index);
            String flowId = row.optString("cash_flow_id", "");
            String month = row.optString("month", "");
            if (flowId.isEmpty() || month.isEmpty()) continue;
            result.put(cashFlowOverrideKey(flowId, month), row.optDouble("amount", 0));
        }
        return result;
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
