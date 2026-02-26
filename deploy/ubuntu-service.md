# Ubuntu systemd service for Leekha Node server

Follow these steps on your Ubuntu server to run the Node server as a systemd service.

1. Copy the sample unit file to `/etc/systemd/system/leekha.service` and edit the `User` and `WorkingDirectory`/`ExecStart` paths.

Sample unit (in repo at `backend/leekha.service`):

```
sudo cp backend/leekha.service /etc/systemd/system/leekha.service
sudo nano /etc/systemd/system/leekha.service
```

2. Reload systemd, enable and start service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable leekha.service
sudo systemctl start leekha.service
sudo systemctl status leekha.service
```

3. Watch logs:

```bash
sudo journalctl -u leekha.service -f
```

Notes:
- Replace `/path/to/Leekha` in the service file with the full path to this project on your server (for example `/home/ubuntu/Leekha`).
- Set `User=` to the account that should run the process (e.g. `ubuntu` or `www-data`).
- Ensure Node is installed at `/usr/bin/node` (adjust `ExecStart` if different).
- Make `backend/start.sh` executable: `chmod +x backend/start.sh`.

Optional: use PM2 instead of systemd for process management:

```bash
sudo npm install -g pm2
cd /path/to/Leekha/backend
pm2 start server.js --name leekha
pm2 save
pm2 startup systemd
```

This README provides a minimal, reproducible systemd setup. Adjust paths and user per your server layout.
