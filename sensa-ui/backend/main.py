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

@app.get("/api/health")
def health_check():
    return {"status": "ok", "mode": "tobii_only"}


# ==========================================
# PLUX CODE (DISABLED FOR NOW)
# ==========================================
"""
import sys
import threading
from collections import deque
from datetime import datetime
import pandas as pd

# PLUX CONFIGURATION
PLUX_API_PATH = Path("C:\\Users\\labadmin\\Documents\\Sensa-main\\sensa-ui\\backend\\plux.pyd") 
DEVICE_ADDRESS = "94-E6-F7-D9-0D-27" 

SAMPLING_RATE = 1000
RESOLUTION = 16
PORTS = [1]
LIVE_BUFFER_SECONDS = 10
LIVE_BUFFER_SIZE = SAMPLING_RATE * LIVE_BUFFER_SECONDS

if str(PLUX_API_PATH) not in sys.path:
    sys.path.insert(0, str(PLUX_API_PATH))

try:
    import plux
except ImportError:
    pass

live_seq = deque(maxlen=LIVE_BUFFER_SIZE)
live_time = deque(maxlen=LIVE_BUFFER_SIZE)
live_eda = deque(maxlen=LIVE_BUFFER_SIZE)
live_dev = None
stream_thread = None
is_recording = False
recorded_rows = []
record_lock = threading.Lock()

class LiveEDAAcquisition(plux.SignalsDev):
    def onRawFrame(self, nSeq, data):
        # Implementation hidden for now
        return not self.running

def acquisition_worker():
    # Implementation hidden for now
    pass

@app.get("/api/status")
def get_status():
    pass

@app.post("/api/stream/start")
def api_start_stream():
    pass

@app.websocket("/ws/stream")
async def websocket_endpoint(websocket: WebSocket):
    pass
"""