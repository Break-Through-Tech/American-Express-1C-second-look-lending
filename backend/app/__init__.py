import warnings

# numpy 2 on macOS Accelerate prints harmless overflow warnings from scikit-learn
warnings.filterwarnings("ignore", category=RuntimeWarning, module="sklearn")
