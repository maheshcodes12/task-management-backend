import json
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List

from app.database import engine, Base, get_db, redis_client
from app.models import User, Task
from app import schemas, utils

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Task Management API", version="v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/v1/auth/register", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user_data.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    new_user = User(email=user_data.email, hashed_password=utils.hash_password(user_data.password), role=user_data.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/v1/auth/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not utils.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    
    access_token = utils.create_access_token(data={"sub": user.email, "role": user.role})
    refresh_token = utils.create_access_token(data={"sub": user.email}, expires_delta=60*24*7)
    
    redis_client.setex(f"refresh_token:{user.email}", 60*24*7*60, refresh_token)
    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}

@app.post("/api/v1/auth/refresh", response_model=schemas.Token)
def refresh_session(payload: schemas.TokenRefreshRequest, db: Session = Depends(get_db)):
    try:
        decoded = utils.jwt.decode(payload.refresh_token, utils.settings.SECRET_KEY, algorithms=[utils.settings.ALGORITHM])
        email: str = decoded.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid refresh context")
    except utils.JWTError:
        raise HTTPException(status_code=401, detail="Expired or malformed token")

    saved_token = redis_client.get(f"refresh_token:{email}")
    if not saved_token or saved_token != payload.refresh_token:
        raise HTTPException(status_code=401, detail="Session revoked or invalid")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = utils.create_access_token(data={"sub": user.email, "role": user.role})
    new_refresh = utils.create_access_token(data={"sub": user.email}, expires_delta=60*24*7)
    
    redis_client.setex(f"refresh_token:{user.email}", 60*24*7*60, new_refresh)
    return {"access_token": new_access, "refresh_token": new_refresh, "token_type": "bearer"}

@app.post("/api/v1/tasks", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(task_data: schemas.TaskCreate, current_user: User = Depends(utils.get_current_user), db: Session = Depends(get_db)):
    new_task = Task(**task_data.model_dump(), user_id=current_user.id)
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    
    redis_client.delete(f"tasks:{current_user.id}")
    redis_client.delete("tasks:all")
    return new_task

@app.get("/api/v1/tasks", response_model=List[schemas.TaskResponse])
def get_tasks(current_user: User = Depends(utils.get_current_user), db: Session = Depends(get_db)):
    cache_key = f"tasks:{current_user.id}"
    cached_tasks = redis_client.get(cache_key)
    if cached_tasks:
        return json.loads(cached_tasks)

    tasks = db.query(Task).filter(Task.user_id == current_user.id).order_by(Task.created_at.desc()).all()
    tasks_json = [schemas.TaskResponse.model_validate(t).model_dump(mode='json') for t in tasks]
    redis_client.setex(cache_key, 60, json.dumps(tasks_json))
    return tasks

@app.put("/api/v1/tasks/{task_id}", response_model=schemas.TaskResponse)
def update_task(task_id: int, task_data: schemas.TaskCreate, current_user: User = Depends(utils.get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.title = task_data.title
    task.description = task_data.description
    task.is_completed = task_data.is_completed
    
    db.commit()
    db.refresh(task)
    
    redis_client.delete(f"tasks:{current_user.id}")
    redis_client.delete("tasks:all")
    return task

@app.delete("/api/v1/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, current_user: User = Depends(utils.get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    db.delete(task)
    db.commit()
    
    redis_client.delete(f"tasks:{current_user.id}")
    redis_client.delete("tasks:all")
    return None

@app.get("/api/v1/admin/tasks", response_model=List[schemas.TaskResponse])
def admin_get_all_tasks(admin_user: User = Depends(utils.require_admin), db: Session = Depends(get_db)):
    cache_key = "tasks:all"
    cached_tasks = redis_client.get(cache_key)
    if cached_tasks:
        return json.loads(cached_tasks)

    tasks = db.query(Task).order_by(Task.created_at.desc()).all()
    tasks_json = [schemas.TaskResponse.model_validate(t).model_dump(mode='json') for t in tasks]
    redis_client.setex(cache_key, 60, json.dumps(tasks_json))
    return tasks