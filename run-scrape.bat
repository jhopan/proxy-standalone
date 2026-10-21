@echo off
cd /d C:\Users\ACER\Documents\Project\Proxy
node scraping\scrape.js --limit 2000 >> logs\scrape.log 2>&1
