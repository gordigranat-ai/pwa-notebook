# 📓 Ежедневник PWA

Прогрессивное веб-приложение для заметок с офлайн-режимом, Push-уведомлениями и WebSocket.

## ✨ Возможности

- 📝 Создание, редактирование и удаление заметок
- 💾 Офлайн-режим (работа без интернета)
- 🔔 Push-уведомления
- 🔌 WebSocket realtime
- 📱 Установка как PWA на любое устройство

## 📦 Установка

git clone https://github.com/gordigranat-ai/pwa-notebook.git
cd pwa-notebook
npm install
npm run generate-vapid

## 🚀 Запуск
# Development (с автоперезагрузкой)
npm run dev

# Production (Windows)
npm run prod

# Production (Linux/Mac)
npm run prod:linux

##📁 Структура
├── server.js          # Express + WebSocket + Push
├── public/
│   ├── index.html     # Главная страница
│   ├── style.css      # Стили
│   ├── app.js         # Клиент
│   ├── sw.js          # Service Worker
│   └── manifest.json  # PWA манифест
└── package.json
