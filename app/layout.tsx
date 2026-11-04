import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jarvis",
  description: "Your AI Assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Prevent Next.js HMR from reloading the page on LAN clients.
            Phones/tablets can't establish a WSS connection over a self-signed
            cert. After repeated failures Next.js calls location.reload().
            Fix 1: intercept the WebSocket constructor — HMR gets a fake socket
                   that reports "connected" immediately and never disconnects.
                   Next.js thinks it's live, stops retrying, never reloads.
            Fix 2: block location.reload() as a safety net. */}
        <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var _WS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    if (typeof url === 'string' && url.indexOf('webpack-hmr') !== -1) {
      var listeners = {};
      var fake = {
        url: url, readyState: 1, bufferedAmount: 0,
        extensions: '', protocol: '', binaryType: 'blob',
        onopen: null, onclose: null, onerror: null, onmessage: null,
        send: function() {},
        close: function() {},
        addEventListener: function(t, fn) {
          if (!listeners[t]) listeners[t] = [];
          listeners[t].push(fn);
        },
        removeEventListener: function(t, fn) {
          if (listeners[t]) listeners[t] = listeners[t].filter(function(f) { return f !== fn; });
        },
        dispatchEvent: function() { return true; }
      };
      setTimeout(function() {
        var e = { type: 'open', target: fake };
        if (typeof fake.onopen === 'function') fake.onopen(e);
        (listeners['open'] || []).forEach(function(fn) { fn(e); });
      }, 50);
      return fake;
    }
    return protocols ? new _WS(url, protocols) : new _WS(url);
  };
  window.WebSocket.prototype = _WS.prototype;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;

  location.reload = function() {
    console.warn('[Jarvis] Blocked programmatic location.reload()');
  };
})();
        ` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
