import os
import time
from pathlib import Path


from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import asyncio

# --- 1. Tobii Routers Imports ---
from routers.analysis import router as analysis_router
from routers.recording import router as recording_router
from routers.sensors import router as sensors_router
from routers.calibration import router as calibration_router
from routers.plux import router as plux_router

# ==========================================
# FASTAPI WEB SERVER SETUP (SINGLE INSTANCE)
# ==========================================
app = FastAPI(title="Sensa Unified Backend (Tobii Focus)")

# Allow React to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mounting the output directory for Tobii heatmap/visualization images
OUTPUTS_DIR = Path(__file__).resolve().parent / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)
app.mount("/api/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

# Including the Tobii Routers
app.include_router(analysis_router)
app.include_router(recording_router)
app.include_router(sensors_router)
app.include_router(calibration_router)
app.include_router(plux_router)

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mode": "tobii_only"}