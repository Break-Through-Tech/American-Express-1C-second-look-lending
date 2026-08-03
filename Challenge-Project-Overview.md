---

> ## Challenge Advisor: Update & Finalize Your Project Overview
>
> > 💡 **These grey text instructions are just for you, the team's Challenge Advisor; please delete them once you have completed the steps below.**
>
> We've pre-populated this Challenge Project Overview page — which is what will be shared with your Break Through Tech student team in August — using the details from your submission form. You should have received an email inviting you to join this repo as a Collaborator, enabling you to add files and make edits.
> 
> In order for your project to be finalized and assigned to a team, please:
> 1. **Review all sections below** and update or expand any content as needed, making sure to address the SME Feedback in the section immediately below. Look for square brackets to find the places below that require additional inputs from you (e.g., "About [Company / Org Name]").
> 2. **Add your dataset** to the [data folder](data) in this repo.
> 3. **Close the Issue assigned to you in this repo** to let us know that you have made your edits and the overview page is ready for final review. You can do this by going to the _Issues_ tab in the top left section of the menu above, add a comment that says "CA review complete", and click the button to Close the Issue. 
>
> If you're unfamiliar with how to edit a page like this in GitHub, check out [this tutorial](https://ubc-lib-geo.github.io/gis-workshop-waml-template/content/handson/edit-readme.html) for a quick overview (start with step 2 and only edit this page), and [this guide](https://ubc-lib-geo.github.io/gis-workshop-waml-template/content/markdown.html) on how to use Markdown to compose text.
>
>
> ❌ Remember that this is a public repo. Do NOT include: Proprietary data, PII, API keys, credentials, or anything confidential.

---

## 📋 BTT Internal Evaluation Notes
*(This section is for BTT staff and CAs only — remove before sharing with students)*

### Technical Vetting
| Check | Status | Notes |
| :--- | :--- | :--- |
| Python Compatibility | 🟢 | Project utilizes standard scikit-learn, pandas, and streamlit which are fully compatible with Google Colab. |
| Data Readiness | 🟡 | Synthetic data requires cleaning and preprocessing; while manageable, the complexity of feature engineering for fairness metrics adds significant overhead. |
| Resource Check | 🟢 | Project fits comfortably within free-tier Colab constraints; gradient boosting (XGBoost/LightGBM) will run efficiently on CPU for this dataset size. |

### Internal Scores
- **Student Fit Score:** 8/10
- **Technical Depth Score:** 7/10
- **Overall Recommendation:** REVISE

### Advisor Feedback Draft
The focus on the 'Inclusive Profit Score' is an excellent, sophisticated framing of a classic business problem. To succeed within 12 weeks, I recommend: 1) Standardize the preprocessing pipeline early to allow more time for Brier score calibration, and 2) Replace Bayesian Hyper-parameter Search with a simplified randomized search to avoid unnecessary computational cycles. Please scope the project for a 12-week delivery timeline.

---

# Second-Look Lending

**Company / Org:** American Express  
**Challenge Advisor:** Thangavel Subramaniam, [Email address]   
**Program:** Break Through Tech AI Studio - Fall 2026  

---

## 🏢 About American Express
American Express is a globally integrated payments company that provides customers with access to products, insights, and experiences that enrich lives and build business success. This project team will work with the lending division to refine credit risk assessment models, aiming to balance corporate profitability with the mission of expanding financial inclusion for underserved communities.

---

## 🎯 The Challenge
### Project Summary
The team will leverage synthetic consumer-loan data to build and evaluate predictive models, including logistic regression, random forests, and gradient boosting, to identify default risks. By optimizing for an 'Inclusive Profit Score,' the project seeks to move beyond traditional risk-averse lending to create business-critical strategies that responsibly approve applicants with limited credit histories.

### Success Criteria
Model quality is measured with ROC-AUC and LogLoss, plus a calibration check (reliability curve and Brier score), and must beat a logistic-regression baseline. Decision quality is measured by expected portfolio profit under a defined cost model (held below a maximum default-rate ceiling) and by the thin-file inclusion gap. The headline metric is the Inclusive Profit Score = expected profit − penalty × inclusion gap.

### Project Milestones
Use these milestones to guide your work. Your team will create a GitHub Projects board to track tasks within each milestone.
| Month | Milestone | Key Activities |
|-------|-----------|----------------|
| **September** | Data Exploration & Preprocessing | Conduct EDA, handle data cleaning for numerical/categorical variables, and establish outlier detection frameworks. |
| **October** | Feature Engineering & Baseline Modeling | Engineer predictive features, build baseline models, and perform model training with grid and Bayesian hyperparameter tuning. |
| **November** | Model Optimization & Evaluation | Finalize model selection, conduct rigorous scoring validation, and perform final deployment and Streamlit app development. |
| **December** | Insights, Deliverables & Presentation | Consolidate business recommendations, optimize final assets, and package the solution for end-to-end presentation. |

> **Note for the team:** Please create a GitHub Projects board in this repository to break these milestones into weekly tasks. Go to the **Projects** tab → **New project** → Choose **Board** → Add columns for each month.

---

## 📊 Dataset
**Name and Source:** American Express Synthetic Loan Dataset (Internal Secure Repository)  
**Format:** CSV/TSV  
**Size:** 1gb to 5gb  
**Location:** Provided via secure cloud bucket access upon project start.  

### Key Details
- synthetic consumer-loan data, numerical/quantitative, categorical, time series, CSV/TSV format, requires cleaning/preprocessing
- Data requires robust handling of time-series constraints and specific preprocessing to ensure categorical variables are correctly encoded for gradient-boosting algorithms.

---

## 🛠️ Suggested Approach
**ML Problem Type:** Classification  
**Recommended Libraries:**
- logistic regression
- random forests
- gradient boosting
- streamlit
**Evaluation Metrics:** ROC-AUC, LogLoss, Brier Score, and Inclusive Profit Score (Profit vs. Inclusion Gap).

---

## 📚 Resources to Get Started
The following resources will help your team understand the problem space and potential technical approaches for this project:
**Background Reading:**
- Industry standards on Fair Lending and Credit Risk Modeling.
**Technical Tutorials:**
- Scikit-learn documentation for Gradient Boosting and Hyperparameter Tuning.
**Code Examples:**
- Reference implementations for building interactive dashboards with Streamlit.

---

## 🤝 How We'll Work Together
**Check-ins:** During our biweekly 60-min AI Studio Lab Section meeting block (2nd and 4th week of every month)  
**Communication:** Slack and project-specific email threads.  
**Response time:** 48 hours for non-urgent inquiries.  
**Recommended Tools:**
- **Coding:** Google Colab Free Tier  
- **Collaboration:** GitHub, Notion  
- **Virtual Meetings:** Zoom, Google Meet  

---

## 🚀 Getting Started
1. **Review this overview document** and note any questions for our first meeting.
2. **Begin reviewing the dataset** using the link provided in the Dataset section.
3. **Read the GitHub Projects documentation** [here](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects).

I'm excited to work with you!

---

## ❓ Questions?
Please bring any questions to our first meeting during the week of August 24th (Break Through Tech's Bridge to Studio - Session B).
