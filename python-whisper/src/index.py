from fastapi import FastAPI, UploadFile, File, HTTPException 
from pydantic import BaseModel 

import whisper 
import subprocess
import tempfile 
import os 

app = FastAPI() 

class Message(BaseModel):
    name: str 

model = whisper.load_model("base") # use standard mid-small Whisper model 
# tiny is not as accurate as base 


def convert_video_to_audio(video_path: str, audio_path: str):
    # python builds the command, asks OS to run the ffmpeg program 
    # aks OS to start the local ffmpeg program on the same computer 

    command = ["ffmpeg", 
               "-y", # overwrite output file if it exists
               "-i", video_path, # input video 
               "-vn", # no video in output 
               "-acodec", "pcm_s16le",
               "-ar", "16000",
               "-ac", "1", # mono audio 
               audio_path]
    
    result = subprocess.run(command, capture_output=True, text=True) # capture_output: for storing output and errors, text=True convert to text

    # print("returncode:", result.returncode)
    # print("stderr:", result.stderr)
    # print("stdout:", result.stdout)

    if result.returncode !=0: # 0 means success 
        raise RuntimeError(result.stderr)
    
    

@app.post("/transcribe-video")
async def transcribe_video(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    # print("filename:", file.filename) # filename: Sample_Video_1.mp4
    
    # separates a filename from its extension 
    video_suffix = os.path.splitext(file.filename)[1] or ".mp4"

    video_path = None 
    audio_path = None 

    try: 
        video_bytes = await file.read() 
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=video_suffix) as video_temp: # tempfile is a python module 
            video_temp.write(video_bytes) # writes uploaded video data into video_temp 
            video_path = video_temp.name
            # print("video_path:", video_path)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as audio_temp: 
            audio_path = audio_temp.name 
            # print("audio_path:", audio_path)

        convert_video_to_audio(video_path, audio_path)

        result = model.transcribe(audio_path)

        return {
            "file name":file.filename, 
            "transcript": result["text"]
        }
    
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {str(e)}") # want HTTP response, not just python error 
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    finally: 
        await file.close() 

        if video_path and os.path.exists(video_path): # if video_path has a value and it exists 
            os.remove(video_path)

        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
     

