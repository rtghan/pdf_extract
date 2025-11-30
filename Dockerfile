# Stage 1: Build Next.js
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:20-bookworm-slim AS runner
WORKDIR /app

# Install system dependencies
# - python3 & pip for engines
# - tesseract-ocr for OCR engine (pytesseract wrapper)
# - poppler-utils provides pdftoppm/pdfinfo for pdf2image
# - libgl1 & libglib2.0 often needed by MinerU/PDF libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN pip3 install --no-cache-dir --break-system-packages uv

# Create virtual environment and install Python dependencies
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Install Python dependencies
# - MinerU with core dependencies via uv
# - Other engines' dependencies
RUN uv pip install -U "mineru[core]" \
    && uv pip install \
    markitdown \
    pytesseract \
    pdf2image

# Copy built Next.js app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/.env* ./

# Copy Python engines
COPY engines ./engines

ENV NODE_ENV=production
ENV AUTH_TRUST_HOST=true
EXPOSE 3000

CMD ["npm", "start"]
