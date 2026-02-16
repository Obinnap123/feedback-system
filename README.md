# Feedback System

A full-stack application for managing student feedback on potential academic courses and lecturers.

## Project Structure

This project follows a monorepo-style structure:

- **`frontend/`**: Next.js application (App Router, TypeScript, Tailwind CSS).

- **`backend/`**: FastAPI application (Python, SQLAlchemy, PostgreSQL).

### Key Files

#### Backend
- `backend/main.py`: Entry point for the API (app initialization & middleware).
- `backend/routers/`: Modular route handlers:
  - `auth.py`: Login, Register.
  - `feedback.py`: Submission, Token validation.
  - `analytics.py`: Admin & Lecturer dashboards.
  - `courses.py`: Token generation & assignments.
- `backend/models.py`: SQLAlchemy database models.
- `backend/schemas.py`: Pydantic schemas for request/response validation.
- `backend/dependencies.py`: Shared dependencies (`get_current_user`, `get_db`).

#### Frontend
- `frontend/app/`: Next.js App Router pages.
- `frontend/services/`: Typed API service modules:
  - `auth.ts`: Authentication (`login`, `register`).
  - `feedback.ts`: Feedback submission logic.
  - `admin.ts`: Admin dashboard data fetching.
  - `lecturer.ts`: Lecturer dashboard data fetching.
- `frontend/types/`: Shared TypeScript interfaces (`User`, `Feedback`, `DashboardResponse`).

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js 18+
- PostgreSQL (or compatible database)

### Backend Setup

1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```

2.  Create and activate a virtual environment:
    ```bash
    python -m venv venv
    # Windows
    .\venv\Scripts\activate
    # macOS/Linux
    source venv/bin/activate
    ```

3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

4.  Configure Environment Variables:
    Create a `.env` file in `backend/` (copy `.env.example` if available) and specify:
    ```env
    DATABASE_URL=postgresql://user:password@localhost:5432/feedback_db
    SECRET_KEY=your-secret-key
    ANON_KEY_SECRET=anon-secret-key
    ```

5.  Run the server:
    ```bash
    uvicorn main:app --reload
    ```
    The API will be available at `http://localhost:8000`.
    Interactive documentation: `http://localhost:8000/docs`.

### Frontend Setup

1.  Navigate to the frontend directory:
    ```bash
    cd frontend
    ```

2.  Install dependencies:
    ```bash
    npm install
    # or
    yarn install
    ```

3.  Run the development server:
    ```bash
    npm run dev
    ```
    Open `http://localhost:3000` with your browser to see the result.

## API Documentation

The backend provides automatic interactive API documentation.
Once running, visit:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Development

### Adding New Features

1.  **Backend**:
    - Add models to `backend/models.py`.
    - Add schemas to `backend/schemas.py`.
    - Create/Update router in `backend/routers/`.
    - Register router in `backend/main.py`.

2.  **Frontend**:
    - Add types to `frontend/types/`.
    - Add API methods to `frontend/services/`.
    - Build UI components in `frontend/app/`.

### Helper Scripts

- `backend/init_db.py`: Initializes the database tables.
- `backend/seed_data.py`: Populates the database with initial test data.
- `backend/check_login.py`: Utility to test login functionality via script.

## Deployment

The project includes a `render.yaml` for deployment on Render, defining services for both the backend (Python/FastAPI) and frontend (Node/Next.js).
