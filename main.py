# main.py
import os
import pandas as pd
from src.ingestion.csv_loader import load_alerts, load_incidents
from src.preprocessing.feature_extraction import extract_features
from src.preprocessing.text_embeddings import generate_embeddings
from src.ai_agent.classifier import classify_incidents
from src.ai_agent.prioritizer import prioritize_incidents
from src.ai_agent.responder import generate_recommendations
from src.reporting.trend_analysis import summarize_trends
from src.interface.chat_interface import run_chat_interface
from src.interface.dashboard import launch_dashboard
import threading

def main():
    print("=== AI Agent for Cybersecurity Incident Triage ===\n")

    # 1. Load Data
    print("Loading data...")
    alerts_df = load_alerts(os.path.join("data/raw", "alerts.csv"))
    incidents_df = load_incidents(os.path.join("data/raw", "incidents.csv"))

    # 2. Preprocessing
    print("Extracting features...")
    alerts_features = extract_features(alerts_df)
    incidents_features = extract_features(incidents_df)

    print("Generating embeddings...")
    embeddings = generate_embeddings(incidents_df['description'].tolist())

    # 3. AI Agent Processing
    print("Classifying incidents...")
    classified_incidents = classify_incidents(incidents_features)

    print("Prioritizing incidents...")
    prioritized_incidents = prioritize_incidents(classified_incidents)

    print("Generating recommended actions...")
    incidents_with_actions = generate_recommendations(prioritized_incidents)

    # 4. Reporting / Trend Analysis
    print("Summarizing trends...")
    trends_summary = summarize_trends(incidents_with_actions)
    print(trends_summary)

    # 5. Launch Dashboard and Chat Interface concurrently
    print("Launching dashboard and chat interface...")

    # Thread for Streamlit dashboard
    def run_dashboard():
        launch_dashboard(incidents_with_actions, trends_summary)

    # Thread for chat interface
    def run_chat():
        run_chat_interface(embeddings, incidents_with_actions)

    dashboard_thread = threading.Thread(target=run_dashboard)
    chat_thread = threading.Thread(target=run_chat)

    dashboard_thread.start()
    chat_thread.start()

    dashboard_thread.join()
    chat_thread.join()


if __name__ == "__main__":
    main()
