# DigiBhoomi — Intelligent Land Record Digitization and Validation System
> **Smart India Hackathon (SIH) Problem Statement 26018**  
> Ministry of Rural Development • Theme: Smart Automation / Land Governance

DigiBhoomi is a prototype system designed to digitize, validate, and preserve legacy Indian land records (such as Jamabandi, Khasra-Khatauni, and Satbara 7/12 extracts).

---

## 🛠️ Technology Stack

- **Frontend:** React 19 + Vite, React Router, Lucide Icons
- **Backend Orchestrator:** Node.js, Express, Multer
- **Database:** MongoDB, Mongoose
- **Document Understanding & Extraction Service:** Python 3.11+, FastAPI, Uvicorn
  - **Primary Engine:** Google Gemini (`gemini-3.5-flash-lite`) via the official Google Gen AI SDK (`google-genai`) with strict Pydantic JSON schema adherence
  - **Fallback / Local Baseline Engine:** EasyOCR (CPU PyTorch) with OpenCV CLAHE contrast enhancement and `pypdfium2` PDF rasterization
- **Security & Storage:** SHA-256 cryptographic hashing (`crypto`), UUID storage filenames, path-traversal prevention

---

## 🚀 Setup & Execution Guide (Windows PowerShell)

### 1. Prerequisites
- **Node.js**: v18+ (tested on v20.19.0)
- **Python**: v3.11+ (tested on Python 3.13)
- **MongoDB**: Community Server v7.0+ (running locally on port `27017`)

#### Starting MongoDB Service on Windows:
```powershell
Start-Service MongoDB
Get-Service MongoDB
```

---

### 2. Environment Variables Configuration

In `server/.env` (template in `server/.env.example`):
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/digibhoomi
UPLOAD_DIR=uploads
MAX_FILE_SIZE_MB=10
PYTHON_OCR_SERVICE_URL=http://127.0.0.1:8000

# Google Gemini API Configuration (Primary Engine)
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
```

> **Note:** The Gemini API key is read strictly on the server side and is never exposed to the React frontend or API responses.

### Role-Based Access Control

Copy `server/.env.example` to `server/.env` and set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` to credentials you control. The password must be at least 12 characters. The first server startup creates that Admin account only if the email does not already exist; there are no default credentials. Citizen accounts register through the sign-in page. Admins can promote Citizens to Officers or Admins and assign documents to individual Officers. Officers see only documents assigned to them; Citizens see only documents they uploaded. Existing records without an owner are available only to Admins until assigned.

Session cookies are HTTP-only and same-site strict. Cookies use the `Secure` attribute automatically in production; serve production traffic over HTTPS. For local HTTP development, leave `COOKIE_SECURE=false`.

Unsafe API requests validate their `Origin` against `CLIENT_ORIGINS` (and reject cross-site Fetch Metadata when no Origin is supplied). Login is limited to 30 attempts per client IP per 15 minutes; registration is limited to 10 per client IP per hour. These throttles are in-memory and per process, so production multi-instance deployments need a shared rate-limit store and correctly configured trusted-proxy settings.

---

### 3. Install Dependencies

Open PowerShell and install dependencies for each service:

```powershell
# 1. Install Node.js backend dependencies
cd server
npm install

# 2. Install Python document extraction service dependencies
cd ../document-service
pip install -r requirements.txt

# 3. Install React frontend dependencies
cd ../client
npm install
```

---

### 4. Running the Application (3 Tiers)

Open three separate PowerShell terminal windows:

#### Terminal 1 — Start Python Document Extraction Microservice:
```powershell
cd document-service
python -m uvicorn app:app --host 127.0.0.1 --port 8000
# Microservice live on http://127.0.0.1:8000
```

#### Terminal 2 — Start Node.js Express Backend:
```powershell
cd server
npm run dev
# Server live on http://localhost:5000
```

#### Terminal 3 — Start React Frontend Client:
```powershell
cd client
npm run dev
# Frontend live on http://localhost:5173
```

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/documents` | Upload a document (`multipart/form-data`, key: `file`). Computes SHA-256 and creates record with status `Uploaded`. |
| `GET` | `/api/documents` | List all uploaded documents sorted newest first (excludes sensitive server paths). |
| `GET` | `/api/documents/:id` | Retrieve single document metadata, OCR raw text, and extracted structured land fields. |
| `GET` | `/api/documents/:id/file` | Securely streams stored document for inline browser preview (PDF/image). |
| `POST` | `/api/documents/:id/process` | Triggers document understanding and field extraction (`engine`: `gemini` or `local`, `language`: `auto`, `hi`, `te`, `en`, `mr`, `ta`). Transitions status to `Needs review`. |
| `PATCH` | `/api/documents/:id/review` | Assigned Officer/Admin saves corrections or approves/rejects a document awaiting review. |
| `PATCH` | `/api/documents/:id/assignment` | Admin assigns a document to an active Officer or clears its assignment. |
| `GET` | `/api/documents/:id/integrity` | Authenticated owner, assigned Officer, or Admin verifies stored-file SHA-256 integrity. |
| `POST` | `/api/auth/register` | Registers and signs in a Citizen; requested role values are ignored. |
| `POST` / `GET` | `/api/auth/login`, `/api/auth/me` | Creates an HTTP-only session or returns the authenticated user. |
| `GET` | `/api/users` | Admin-only user and role list. |
| `PATCH` | `/api/users/:id/role` | Admin-only role assignment (`Citizen`, `Officer`, `Admin`). |
| `GET` | `/api/audit` | Admin-only persistent audit history. |
| `GET` | `/api/health` | Backend and MongoDB connection health check. |
| `GET` | `http://127.0.0.1:8000/health` | Python microservice health and engine status check. |

---

## 🧪 Automated Acceptance Tests

The integration tests are isolated from the normal application database. They refuse a database name that does not end in `_test`, use `digibhoomi_rbac_test` by default, and store uploads in `server/uploads_rbac_test`. Start a separate test backend in its own PowerShell terminal:

```powershell
cd server
$env:PORT = '5001'
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/digibhoomi_rbac_test'
$env:UPLOAD_DIR = 'uploads_rbac_test'
$env:BOOTSTRAP_ADMIN_EMAIL = ''
$env:BOOTSTRAP_ADMIN_PASSWORD = ''
npm start
```

Do not point test variables at a production or normal development database. In another terminal, run:

```powershell
cd server
node test_rbac.js
node test_integrity.js
node test_api.js
node test_phase3_acceptance.js
```

The Phase 3 suite uses the local Python service on port `8000`. `test_gemini_live.js` additionally requires a valid Gemini API key and makes live external API calls.

---

## 🔒 Security & Reliability Measures Implemented
1. **Isolated Storage:** Uploaded documents are saved in `server/uploads/`, outside public web client assets.
2. **UUID Storage Filenames:** File storage names are generated via `crypto.randomUUID()`. Original filenames are never used as server paths.
3. **MIME & Extension Double-Check:** Rejects unauthorized extensions and mismatched MIME types.
4. **Path Traversal Protection:** File streaming resolves files strictly inside `UPLOAD_DIR` using `path.basename()`.
5. **No Orphaned Files:** If database insertion fails after file upload, the uploaded file is automatically deleted from disk.
6. **Hidden File Paths & Credentials:** Server filesystem paths and `GEMINI_API_KEY` are strictly suppressed from all client responses.
7. **No Stuck States:** If OCR or AI extraction fails, the document record cleanly transitions out of `Processing` with error details recorded.
8. **100% Unicode Preservation:** Full native Devanagari and Telugu scripts are preserved across storage, processing, and display without lossy normalization.
