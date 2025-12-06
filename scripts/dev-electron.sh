#!/bin/bash

# Script per avviare Vite e Electron insieme

echo "🚀 Starting Undergrain development environment..."

# Controlla se Vite è già in esecuzione
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ Vite dev server already running on port 5173"
else
    echo "📦 Starting Vite dev server..."
    # Avvia Vite in background
    npm run dev &
    VITE_PID=$!
    
    # Aspetta che Vite sia pronto
    echo "⏳ Waiting for Vite to start..."
    sleep 3
    
    # Verifica che Vite sia partito
    if ! lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null ; then
        echo "❌ Failed to start Vite dev server"
        exit 1
    fi
    
    echo "✅ Vite dev server started (PID: $VITE_PID)"
fi

# Avvia Electron
echo "⚡ Starting Electron..."
NODE_ENV=development electron .

# Se abbiamo avviato Vite, termina il processo quando Electron si chiude
if [ ! -z "$VITE_PID" ]; then
    echo "🛑 Stopping Vite dev server..."
    kill $VITE_PID 2>/dev/null
fi

