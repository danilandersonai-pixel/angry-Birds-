// Точка входа: приложение «Сердитые Птицы» (src/app/App.ts) — загрузка шрифтов, прогрев спрайтов, меню и игра.

import { App } from './app/App';

const root = document.getElementById('app') ?? document.body;
const app = new App(root);
void app.start();
