plugins {
    id("com.android.application")
}

/** Escape a Gradle property value so it is safe as a generated Java string literal. */
fun javaStringLiteral(value: String): String {
    val escaped = value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    return "\"$escaped\""
}

val supabaseUrl: String = providers.gradleProperty("supabaseUrl").getOrElse("")
val supabaseAnonKey: String = providers.gradleProperty("supabaseAnonKey").getOrElse("")

android {
    namespace = "com.finplannar.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.finplannar.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        buildConfigField("String", "SUPABASE_URL", javaStringLiteral(supabaseUrl))
        buildConfigField("String", "SUPABASE_ANON_KEY", javaStringLiteral(supabaseAnonKey))
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
