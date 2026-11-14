# Bank Customer Churn Analysis

A Python project for exploring bank customer data through summary statistics, geography counts, distributions, correlations, and churn breakdowns.

![Bank customers by geography](geography_customers.png)

## Project files

- `bank_analaysis.py` — main analysis script.
- `churn-selected-columns.csv` — dataset read by the script.
- `geography_customers.png` — customer count chart by geography.

## Requirements

- Python 3
- pandas
- matplotlib

Install the Python dependencies:

```bash
python -m pip install pandas matplotlib
```

## Run

Keep the CSV in the same directory as the script, then run:

```bash
python bank_analaysis.py
```

The script prints summary information and opens charts for the available columns. If the dataset contains an `Exited` column, it also prints and charts churn counts and average age by churn status.

## Data note

The CSV may contain customer-level and financial data. Share it publicly only if you have verified that it is synthetic or explicitly cleared for public distribution.
