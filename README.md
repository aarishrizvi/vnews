<div align="center">

# 📰 VNews

### AI-Powered News Verification with Retrieval-Augmented Generation

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,100:2563eb&height=160&section=header&text=VNews&fontSize=58&fontColor=ffffff&animation=fadeIn&fontAlignY=42" width="100%" />

<p>
  <b>Verify claims. Retrieve evidence. See why.</b><br/>
  A multi-source news verification system built with Next.js, Pinecone, Firebase and Google Gemma.
</p>

<p>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript" />
  <img src="https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-orange?style=for-the-badge&logo=firebase" />
  <img src="https://img.shields.io/badge/Pinecone-RAG-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Gemma-Google-purple?style=for-the-badge" />
</p>

</div>

---

## ✨ What is VNews?

VNews checks a user's claim against **multiple evidence sources** instead of relying only on an LLM's internal knowledge.

```text
User Claim
    ↓
Intent Check + Claim Analysis
    ↓
┌───────────────┬──────────────┬────────────────────┐
│   Pinecone    │   NewsAPI    │ Google Fact Check  │
│ Semantic RAG  │  Live News   │    Reviews         │
└───────┬───────┴──────┬───────┴──────────┬─────────┘
        └───────────────┼─────────────────┘
                        ↓
                 Evidence Pool
                        ↓
                 Gemma Verdict
                        ↓
          TRUE / FALSE / MIXED / UNVERIFIED
                        ↓
              Sources + Explanation
```

## ⚡ Features

- 🔎 **Multi-source verification** using Pinecone, NewsAPI and Google Fact Check Tools
- 🧠 **Gemma-powered analysis** with evidence-grounded reasoning
- 📚 **RAG knowledge base** with Pinecone integrated embeddings and BGE reranking
- ⚖️ **Deterministic fallback** when the AI service is unavailable or rate-limited
- 📡 **Real-time verification streaming** using Server-Sent Events
- 🔐 **Firebase authentication** and protected admin actions
- 🗂️ **Knowledge-base administration** for adding and deleting indexed documents
- 📊 **Supporting vs. contradicting evidence** shown separately

## 🧩 Verdicts

| Verdict | Meaning |
|---|---|
| ✅ TRUE | Evidence supports the claim |
| ❌ FALSE | Evidence contradicts the claim |
| ⚠️ MIXED | Credible evidence exists on both sides |
| ❓ UNVERIFIED | Not enough reliable evidence for a factual verdict |

## 🏗️ Stack

**Frontend**  
Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Framer Motion

**Backend / Services**  
Next.js server-side routes · Firebase Auth · Firestore · Firebase Storage

**AI / Retrieval**  
Google Gemma · Pinecone · BGE reranker · NewsAPI · Google Fact Check Tools API

## 🎬 Verification Flow

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&size=20&duration=2600&pause=700&color=2563EB&center=true&vCenter=true&width=780&lines=Submit+claim+%E2%86%92+Analyze+%E2%86%92+Retrieve+evidence+%E2%86%92+Judge+%E2%86%92+Verify;Pinecone+%2B+NewsAPI+%2B+Fact+Check+%E2%86%92+Unified+evidence;Gemma+%2B+deterministic+fallback+%E2%86%92+final+verdict" alt="VNews workflow" />
</p>

## 🚀 Run Locally

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

### Environment variables

Configure the required API keys and Firebase settings in your local environment. **Never commit secrets to GitHub.**

## 📁 Project Highlights

```text
app/                  Next.js pages and API routes
lib/services/         Verification, Pinecone, NewsAPI, Fact Check
lib/firebase/         Firebase auth and server-side checks
components/           UI and result rendering
types/                Shared verification types
```

## 🛡️ Current Status

VNews currently has the **core verification pipeline implemented**. Basic per-IP rate limiting and reactive AI quota handling are present, while distributed rate limiting, production deployment configuration, and OCR/image verification remain future work.

## 📌 Project

Built as a BCA project focused on practical, explainable AI-assisted news verification.

<div align="center">

### ⭐ Star the repository if you find the project interesting.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:2563eb,100:0f172a&height=100&section=footer&text=Verify%20before%20you%20share.&fontSize=22&fontColor=ffffff&animation=fadeIn&fontAlignY=70" width="100%" />

</div>
