# -*- coding: utf-8 -*-
"""点名系统本地服务器（无缓存模式）

和 `python -m http.server` 的区别只有一条：每个响应都带 Cache-Control: no-store，
让手机浏览器每次打开都取最新文件 —— 避免“改了代码、手机上还是旧的”这种问题。

用法（在项目目录下）：
    python serve.py             # 默认 4173 端口
    python serve.py 8080        # 指定端口
"""
import http.server
import socket
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):   # 少刷屏
        pass


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    ip = lan_ip()
    print('=' * 52)
    print('  点名系统 本地服务器（无缓存模式）')
    print('  电脑上打开：http://localhost:%d/' % PORT)
    print('  手机上打开：http://%s:%d/' % (ip, PORT))
    print('  手机第一次拿新版本：http://%s:%d/?v=%s' % (ip, PORT, 'fresh'))
    print('  按 Ctrl+C 停止')
    print('=' * 52)
    with socketserver.ThreadingTCPServer(('', PORT), NoCacheHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止')
