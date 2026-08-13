const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });
app.use(express.static(path.join(__dirname, 'public')));

function startApp(command) {
  if (command.startsWith('http')) { exec(`start chrome ${command}`); }
  else { exec(`start ${command}`); }
}

// ========== ARKA PLAN POWERSHELL İLE ANLIK FARE KONTROLÜ ==========
let mouseProcess = null;

function startMouseProcess() {
  if (mouseProcess && !mouseProcess.killed) return;
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms;
    Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name M -Namespace W;
    while ($true) {
      $line = [Console]::ReadLine();
      if ($line -match '^move (-?\\d+),(-?\\d+)$') {
        $x = [int]$Matches[1]; $y = [int]$Matches[2];
        $pos = [System.Windows.Forms.Cursor]::Position;
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(($pos.X + $x), ($pos.Y + $y));
      } elseif ($line -eq 'click') {
        [W.M]::mouse_event(0x0002,0,0,0,0); [W.M]::mouse_event(0x0004,0,0,0,0);
      } elseif ($line -eq 'rightclick') {
        [W.M]::mouse_event(0x0008,0,0,0,0); [W.M]::mouse_event(0x0010,0,0,0,0);
      } elseif ($line -eq 'dblclick') {
        [W.M]::mouse_event(0x0002,0,0,0,0); [W.M]::mouse_event(0x0004,0,0,0,0);
        Start-Sleep -Milliseconds 80;
        [W.M]::mouse_event(0x0002,0,0,0,0); [W.M]::mouse_event(0x0004,0,0,0,0);
      } elseif ($line -eq 'exit') { break }
    }
  `;
  mouseProcess = spawn('powershell', ['-NoProfile', '-Command', psScript], { stdio: ['pipe', 'pipe', 'pipe'] });
  mouseProcess.stdin.setDefaultEncoding('utf-8');
}
function moveMouse(dx, dy) {
  if (!mouseProcess || mouseProcess.killed) startMouseProcess();
  if (mouseProcess && mouseProcess.stdin) mouseProcess.stdin.write(`move ${Math.round(dx)},${Math.round(dy)}\n`);
}
function click(b = 'left') {
  if (!mouseProcess || mouseProcess.killed) startMouseProcess();
  if (mouseProcess && mouseProcess.stdin) mouseProcess.stdin.write(b === 'left' ? 'click\n' : 'rightclick\n');
}
function dblClick() {
  if (!mouseProcess || mouseProcess.killed) startMouseProcess();
  if (mouseProcess && mouseProcess.stdin) mouseProcess.stdin.write('dblclick\n');
}
function sendKey(key) {
  exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')"`);
}

startMouseProcess();

io.on('connection', (socket) => {
  console.log('📱 Bağlandı:', socket.id);

  // 📋 Bilgisayar panosuna yaz
  socket.on('clipboard', (text) => {
    if (!text || !text.trim()) return;
    const safeText = text.replace(/'/g, "''").replace(/"/g, '\\"');
    exec(`powershell -Command "Set-Clipboard -Value '${safeText}'"`, (err) => {
      if (err) { socket.emit('clipboardError'); }
      else { socket.emit('clipboardDone', text); }
    });
  });

  // 📋 Bilgisayar panosundan oku
  socket.on('readClipboard', () => {
    exec('powershell -Command "Get-Clipboard"', (err, stdout) => {
      if (!err && stdout.trim()) {
        socket.emit('clipboardContent', stdout.trim());
      } else {
        socket.emit('clipboardContent', '');
      }
    });
  });

  // 📸 Fotoğraf
  socket.on('photo', (data) => {
    try {
      const m = data.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (!m) return socket.emit('photoError');
      const buf = Buffer.from(m[2], 'base64');
      const f = path.join(os.homedir(), 'Desktop', `NovaPad_${Date.now()}.${m[1]==='jpeg'?'jpg':m[1]}`);
      fs.writeFileSync(f, buf);
      exec(`start "" "${f}"`);
      socket.emit('photoSent');
    } catch (_) { socket.emit('photoError'); }
  });

  // 📂 Dosya
  socket.on('fileUpload', (data) => {
    try {
      const m = data.data.match(/^data:(.*);base64,(.+)$/);
      if (!m) return socket.emit('fileError');
      const buf = Buffer.from(m[2], 'base64');
      const f = path.join(os.homedir(), 'Desktop', data.name || `Dosya_${Date.now()}.bin`);
      fs.writeFileSync(f, buf);
      socket.emit('fileSent', data.name);
    } catch (_) { socket.emit('fileError'); }
  });

  // 🧹 Temizlik
  socket.on('cleanStorage', () => {
    exec('powershell -Command "Clear-RecycleBin -Force -EA 0; rm $env:TEMP\\* -Recurse -Force -EA 0; rm $env:WINDIR\\Temp\\* -Recurse -Force -EA 0"');
    socket.emit('storageCleaned');
  });

  // ⏱️ Zamanlayıcı
  socket.on('timerShutdown', (min) => {
    const sec = parseInt(min) * 60;
    if (isNaN(sec) || sec <= 0) return;
    exec(`shutdown /s /t ${sec}`, (err) => {
      if (err) socket.emit('timerError');
      else socket.emit('timerStarted', min);
    });
  });
  socket.on('cancelShutdown', () => {
    exec('shutdown /a', (err) => {
      if (err) socket.emit('cancelError');
      else socket.emit('shutdownCancelled');
    });
  });

  socket.on('type', (text) => startApp(`https://www.google.com/search?q=${encodeURIComponent(text)}`));

  socket.on('key', (key) => {
    switch (key) {
      case 'ctrl+t': sendKey('^t'); break;
      case 'ctrl+w': sendKey('^w'); break;
      case 'alt+left': sendKey('%{LEFT}'); break;
      case 'alt+right': sendKey('%{RIGHT}'); break;
      case 'volume_up': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"'); break;
      case 'volume_down': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"'); break;
      case 'volume_mute': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"'); break;
      case 'media_play_pause': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]179)"'); break;
      case 'media_prev': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]177)"'); break;
      case 'media_next': exec('powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]176)"'); break;
      case 'escape': sendKey('{ESC}'); break;
      case 'enter': sendKey('{ENTER}'); break;
      case 'tab': sendKey('{TAB}'); break;
      case 'shiftTab': sendKey('+{TAB}'); break;
      case 'up': sendKey('{UP}'); break;
      case 'down': sendKey('{DOWN}'); break;
      case 'left': sendKey('{LEFT}'); break;
      case 'right': sendKey('{RIGHT}'); break;

      case 'lock': exec('rundll32.exe user32.dll,LockWorkStation'); break;
      case 'chrome': startApp('chrome'); break;
      case 'notepad': startApp('notepad'); break;
      case 'calc': startApp('calc'); break;
      case 'explorer': startApp('explorer'); break;
      case 'taskmgr': startApp('taskmgr'); break;
      case 'control': startApp('control'); break;
      case 'snipping': startApp('snippingtool'); break;
      case 'spotify': startApp('https://open.spotify.com'); break;
      case 'youtubeMusic': startApp('https://music.youtube.com'); break;
      case 'youtube': startApp('https://youtube.com'); break;
      case 'gmail': startApp('https://mail.google.com'); break;
      case 'whatsapp': startApp('https://web.whatsapp.com'); break;
      case 'github': startApp('https://github.com'); break;

      case 'minimizeAll': exec('powershell -Command "$shell = New-Object -ComObject shell.application; $shell.MinimizeAll()"'); break;
      case 'monitorOff': exec('powershell -Command "Add-Type -MemberDefinition \'[DllImport(\\\"user32.dll\\\")] public static extern int SendMessage(int hWnd, int Msg, int wParam, int lParam);\' -Name W -Namespace S; [S.W]::SendMessage(0xFFFF,0x0112,0xF170,2)"'); break;
      case 'shutdown': exec('shutdown /s /t 0'); break;
      case 'restart': exec('shutdown /r /t 0'); break;
      case 'screenFlip': exec('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.DisplaySettings]::SetDisplayMode(0,0,16,90)"'); break;
      case 'screenNormal': exec('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.DisplaySettings]::SetDisplayMode(0,0,16,0)"'); break;
      case 'mouseCrazy': (() => { for (let i=0;i<40;i++) setTimeout(() => moveMouse((Math.random()-0.5)*60,(Math.random()-0.5)*60), i*25); })(); break;
      case 'matrix': exec('start powershell -NoExit -Command "$r=New-Object Random; while($true){Write-Host -NoNewline ([char]$r.Next(33,126));Start-Sleep -Milliseconds 50;if($r.Next(100) -lt 5){Write-Host \'\';Start-Sleep -Milliseconds 200}}"'); break;
      default: if (key.startsWith('http')) startApp(key); break;
    }
  });

  socket.on('mouseMove', (data) => moveMouse(data.dx, data.dy));
  socket.on('mouseClick', () => click('left'));
  socket.on('mouseRightClick', () => click('right'));
  socket.on('mouseDoubleClick', () => dblClick());
});

server.listen(3000, '0.0.0.0', () => console.log('🚀 http://localhost:3000'));