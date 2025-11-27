<div align="center">
<img src="src/assets/logo.png" alt="EcoWatch logo" title="EcoWatch logo" width="200"/>

# EcoWatch: Intelligent Biodiversity & Disaster Monitoring System

</div>

### **Introduction**

EcoWatch is an intelligent environmental monitoring system designed to support biodiversity conservation and disaster preparedness in ecologically sensitive regions such as Uttarakhand.
Built as a full-stack Electron desktop application, EcoWatch integrates real-time environmental data, satellite observations, and machine learning techniques to provide early warnings, environmental insights, and automated alerts for weather anomalies, air quality changes, and seismic activities.

The system focuses on forest officers, biodiversity researchers, environmental workers, and disaster management teams by delivering accurate, location-specific information through interactive dashboards and automated email notifications.

Key Features

- Real-Time Weather Monitoring: Fetches live temperature, humidity, rainfall, and snowfall data.
- Air Quality Tracking: Monitors AQI, PM2.5, and pollution levels for health and environmental safety.
- Earthquake Detection: Retrieves seismic event data from official sources such as NCS and filters region-specific alerts.
- IMD Weather Alerts: Integrates official weather warnings and extreme event notifications.
- Automated Email Alerts: Uses NodeMailer to send daily and emergency alert emails based on user-selected cities.
- AI-Based Risk Prediction: Uses machine learning models (Random Forest, spatial-temporal analysis) to predict disaster-prone zones.
- Biodiversity Support Tools: Provides environmental insights useful for wildlife and forest department monitoring.
- Interactive Maps & Dashboards: Visualizes alerts, risk zones, and environmental trends.
- Cross-Platform Desktop App: Runs seamlessly on Windows, macOS, and Linux using Electron.
- Offline-First Storage: Uses SQLite for secure local data storage and faster performance.

---

### **Tech Stack**

Frontend:

- Electron.js
- HTML, CSS, JavaScript
- Chart.js/Recharts for environmental data visualization

Backend:

- Node.js
- RESTful APIs for environmental data fetching and processing

Machine Learning Layer:

- Python (scikit-learn for Random Forest and predictive analytics)
- Flask/FastAPI microservices for ML-based risk analysis

Database:

- SQLite (local secure storage)

Example Key Functions

- Register users with city-based configuration
- Fetch real-time weather and AQI data
- Retrieve earthquake data and filter by Uttarakhand region
- Detect IMD-issued weather and disaster alerts
- Send automated daily and emergency email notifications
- Predict disaster risk levels using machine learning models
- Visualize environmental trends through charts and dashboards
- Maintain secure local storage of alerts and user preferences

---

<div align="center">
  
## Download

Access the app:
[![EcoWatch exe](https://img.shields.io/github/v/release/Varun-Singh-Rana/Biodiversity_Project.svg?maxAge=3600&label=Biodiversity_Project-exe&labelColor=06599d&color=043b69)](https://github.com/Varun-Singh-Rana/Biodiversity_Project/releases)

</div>

---

### **Contributing**

> Contributions are welcome! Please feel free to submit issues or pull requests.

---

### **License**

> This project is licensed under the MIT License — free to use, modify, and distribute with credit.
