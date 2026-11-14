
import pandas as pd
import matplotlib.pyplot as plt

# 1. Load dataset
df = pd.read_csv("churn-selected-columns.csv")

# 2. Clean data
df.columns = df.columns.str.strip()
df = df.drop_duplicates()
df = df.dropna(subset=["CreditScore", "Age", "Balance"])

print("\n===== BANK CUSTOMER CHURN ANALYSIS =====")
print("Total Customers:", len(df))
print("\nFirst 5 Records:")
print(df.head().to_string(index=False))

# 3. Basic statistics
print("\n===== CUSTOMER STATISTICS =====")
for col in ["CreditScore", "Age", "Tenure",
            "Balance", "NumOfProducts"]:
    if col in df.columns:
        print(f"{col} Average: {df[col].mean():.2f}")

# 4. Geography analysis
if "Geography" in df.columns:
    print("\n===== CUSTOMERS BY COUNTRY =====")
    print(df["Geography"].value_counts().to_string())

    df["Geography"].value_counts().plot(
        kind="bar", title="Customers by Country"
    )
    plt.xlabel("Country")
    plt.ylabel("Number of Customers")
    plt.tight_layout()
    plt.show()

# 5. Distribution plots
for col in ["Age", "Balance", "CreditScore"]:
    if col in df.columns:
        plt.figure(figsize=(7, 4))
        plt.hist(df[col], bins=20, edgecolor="black")
        plt.title(col + " Distribution")
        plt.xlabel(col)
        plt.ylabel("Number of Customers")
        plt.tight_layout()
        plt.show()

# 6. Correlation analysis
numeric_cols = df.select_dtypes(include="number").columns
numeric_cols = [
    col for col in numeric_cols
    if col not in ["RowNumber", "CustomerId"]
]

corr = df[numeric_cols].corr()

print("\n===== CORRELATION MATRIX =====")
print(corr.round(2).to_string())

plt.figure(figsize=(8, 6))
plt.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)
plt.colorbar(label="Correlation")
plt.xticks(range(len(corr.columns)), corr.columns,
           rotation=45, ha="right")
plt.yticks(range(len(corr.columns)), corr.columns)
plt.title("Bank Customer Correlation Heatmap")
plt.tight_layout()
plt.show()

# 7. Churn analysis if target column exists
if "Exited" in df.columns:
    print("\n===== CHURN ANALYSIS =====")
    print(df["Exited"].value_counts().to_string())

    df["Exited"].value_counts().sort_index().plot(
        kind="bar", color=["green", "red"]
    )
    plt.title("Customer Churn: 0 = Stayed, 1 = Left")
    plt.xlabel("Exited")
    plt.ylabel("Number of Customers")
    plt.tight_layout()
    plt.show()

    print("\nAverage Age by Churn Status:")
    print(df.groupby("Exited")["Age"].mean().round(2))

else:
    print("\nChurn prediction is not possible with this CSV.")
    print("Please use the full dataset containing the Exited column.")

# 8. Summary
print("\n===== SUMMARY =====")
print("Average Customer Age:", round(df["Age"].mean(), 2))
print("Average Credit Score:", round(df["CreditScore"].mean(), 2))
print("Average Balance:", round(df["Balance"].mean(), 2))

if "Geography" in df.columns:
    print("Customers from:", df["Geography"].nunique(), "countries")

print("\nAnalysis Completed Successfully!")
