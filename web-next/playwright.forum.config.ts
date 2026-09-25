import {defineConfig} from '@playwright/test';
import compat from './playwright.compat.config';
export default defineConfig({...compat,testMatch:/forum-browser\.spec\.ts/});
