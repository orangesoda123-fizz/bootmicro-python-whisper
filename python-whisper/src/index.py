from fastapi import FastAPI, UploadFile, File, HTTPException
import whisper
import subprocess
import tempfile
import os
import requests

app = FastAPI()

VIDEO_STORAGE_SERVICE_URL = os.getenv("VIDEO_STORAGE_SERVICE_URL", "http://video-storage")

model = whisper.load_model("base")


def convert_video_to_audio(video_path: str, audio_path: str):
    command = [
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path,
    ]

    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)


def write_bytes_to_temp_video(video_bytes: bytes, suffix: str = ".mp4") -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as video_temp:
        video_temp.write(video_bytes)
        return video_temp.name


def download_video_from_storage(video_id: str) -> str:
    response = requests.get(
        f"{VIDEO_STORAGE_SERVICE_URL}/video",
        params={"id": video_id},
        stream=True,
        timeout=120,
    )

    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Video with id {video_id} was not found.")

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve video {video_id} from video-storage.",
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as video_temp:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                video_temp.write(chunk)
        return video_temp.name


def transcribe_video_file(video_path: str, display_name: str):
    audio_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as audio_temp:
            audio_path = audio_temp.name

        convert_video_to_audio(video_path, audio_path)
        result = model.transcribe(audio_path)

        return {
            "file name": display_name,
            "transcript": result["text"],
        }
    except RuntimeError as e:
        print("FFmpeg error:", str(e))
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        print("Transcription error:", repr(e))
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


@app.post("/transcribe-video")
async def transcribe_uploaded_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    video_suffix = os.path.splitext(file.filename)[1] or ".mp4"
    video_path = None

    try:
        video_bytes = await file.read()
        video_path = write_bytes_to_temp_video(video_bytes, video_suffix)
        return transcribe_video_file(video_path, file.filename)
    finally:
        await file.close()
        if video_path and os.path.exists(video_path):
            os.remove(video_path)


@app.post("/transcribe-video/{video_id}")
async def transcribe_video_by_id(video_id: str):
    video_path = None

    try:
        video_path = download_video_from_storage(video_id)
        return transcribe_video_file(video_path, video_id)
    finally:
        if video_path and os.path.exists(video_path):
            os.remove(video_path)