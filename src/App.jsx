import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_W = 430;
const TARGET_H = 559;
const PPI = 300;
const INCHES_W = TARGET_W / PPI;
const INCHES_H = TARGET_H / PPI;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function setPpiMetadata(canvas, ppi, format) {
  if (format === "image/png") {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        blob.arrayBuffer().then((buf) => {
          const arr = new Uint8Array(buf);
          const pHYs = createPHYsChunk(ppi);
          const idx = findIHDREnd(arr);
          if (idx === -1) return resolve(blob);
          const before = arr.slice(0, idx);
          const after = arr.slice(idx);
          const result = new Uint8Array(before.length + pHYs.length + after.length);
          result.set(before, 0);
          result.set(pHYs, before.length);
          result.set(after, before.length + pHYs.length);
          resolve(new Blob([result], { type: "image/png" }));
        });
      }, "image/png");
    });
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      blob.arrayBuffer().then((buf) => {
        const arr = new Uint8Array(buf);
        const modified = setJpegDpi(arr, ppi);
        resolve(new Blob([modified], { type: "image/jpeg" }));
      });
    }, "image/jpeg", 0.95);
  });
}

function createPHYsChunk(ppi) {
  const ppm = Math.round(ppi / 0.0254);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1;
  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, 9);
  const crcData = new Uint8Array(type.length + data.length);
  crcData.set(type, 0);
  crcData.set(data, type.length);
  const crc = crc32(crcData);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  chunk.set(length, 0);
  chunk.set(type, 4);
  chunk.set(data, 8);
  chunk.set(crcBytes, 17);
  return chunk;
}

function findIHDREnd(arr) {
  for (let i = 8; i < arr.length - 4; i++) {
    if (arr[i] === 0x49 && arr[i + 1] === 0x48 && arr[i + 2] === 0x44 && arr[i + 3] === 0x52) {
      const len = new DataView(arr.buffer, i - 4, 4).getUint32(0);
      return i + 4 + len + 4;
    }
  }
  return -1;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function setJpegDpi(arr, ppi) {
  if (arr[0] !== 0xFF || arr[1] !== 0xD8) return arr;
  const jfif = new Uint8Array([
    0xFF, 0xE0, 0x00, 0x10,
    0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01,
    0x01,
    (ppi >> 8) & 0xFF, ppi & 0xFF,
    (ppi >> 8) & 0xFF, ppi & 0xFF,
    0x00, 0x00
  ]);
  let insertPos = 2;
  if (arr[2] === 0xFF && arr[3] === 0xE0) {
    const segLen = (arr[4] << 8) | arr[5];
    const before = arr.slice(0, 2);
    const after = arr.slice(2 + 2 + segLen);
    const result = new Uint8Array(before.length + jfif.length + after.length);
    result.set(before, 0);
    result.set(jfif, before.length);
    result.set(after, before.length + jfif.length);
    return result;
  }
  const before = arr.slice(0, insertPos);
  const after = arr.slice(insertPos);
  const result = new Uint8Array(before.length + jfif.length + after.length);
  result.set(before, 0);
  result.set(jfif, before.length);
  result.set(after, before.length + jfif.length);
  return result;
}

export default function PassportPhotoCorrector() {
  const [image, setImage] = useState(null);
  const [imgEl, setImgEl] = useState(null);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffsetStart, setDragOffsetStart] = useState({ x: 0, y: 0 });
  const [downloadFormat, setDownloadFormat] = useState("image/jpeg");
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [baseScale, setBaseScale] = useState(1);

  const canvasRef = useRef(null);
  const previewRef = useRef(null);

  const PREVIEW_SCALE = 0.75;
  const previewW = Math.round(TARGET_W * PREVIEW_SCALE);
  const previewH = Math.round(TARGET_H * PREVIEW_SCALE);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setImage(url);
      const scaleW = TARGET_W / img.width;
      const scaleH = TARGET_H / img.height;
      const fitScale = Math.max(scaleW, scaleH);
      setBaseScale(fitScale);
      setScale(1);
      setRotation(0);
      setOffsetX(0);
      setOffsetY(0);
    };
    img.src = url;
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  useEffect(() => {
    if (!imgEl || !previewRef.current) return;
    const ctx = previewRef.current.getContext("2d");
    ctx.clearRect(0, 0, previewW, previewH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, previewW, previewH);
    ctx.clip();

    const effectiveScale = baseScale * scale;
    const cx = previewW / 2 + offsetX * PREVIEW_SCALE;
    const cy = previewH / 2 + offsetY * PREVIEW_SCALE;

    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(effectiveScale * PREVIEW_SCALE, effectiveScale * PREVIEW_SCALE);
    ctx.drawImage(imgEl, -imgEl.width / 2, -imgEl.height / 2);
    ctx.restore();

    // Guide overlay
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    const thirdW = previewW / 3;
    const thirdH = previewH / 3;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(thirdW * i, 0);
      ctx.lineTo(thirdW * i, previewH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, thirdH * i);
      ctx.lineTo(previewW, thirdH * i);
      ctx.stroke();
    }

    // Head oval guide
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const ovalCx = previewW / 2;
    const ovalCy = previewH * 0.38;
    const ovalRx = previewW * 0.24;
    const ovalRy = previewH * 0.28;
    ctx.ellipse(ovalCx, ovalCy, ovalRx, ovalRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

  }, [imgEl, scale, rotation, offsetX, offsetY, baseScale, previewW, previewH]);

  const handleMouseDown = (e) => {
    if (!imgEl) return;
    setDragging(true);
    const rect = previewRef.current.getBoundingClientRect();
    setDragStart({ x: e.clientX || e.touches?.[0]?.clientX, y: e.clientY || e.touches?.[0]?.clientY });
    setDragOffsetStart({ x: offsetX, y: offsetY });
  };

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    const dx = (clientX - dragStart.x) / PREVIEW_SCALE;
    const dy = (clientY - dragStart.y) / PREVIEW_SCALE;
    setOffsetX(dragOffsetStart.x + dx);
    setOffsetY(dragOffsetStart.y + dy);
  }, [dragging, dragStart, dragOffsetStart]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleMouseMove);
    window.addEventListener("touchend", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const renderFinal = useCallback(async () => {
    if (!imgEl) return;
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, TARGET_W, TARGET_H);

    const effectiveScale = baseScale * scale;
    const cx = TARGET_W / 2 + offsetX;
    const cy = TARGET_H / 2 + offsetY;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(effectiveScale, effectiveScale);
    ctx.drawImage(imgEl, -imgEl.width / 2, -imgEl.height / 2);
    ctx.restore();

    const blob = await setPpiMetadata(canvas, PPI, downloadFormat);
    const ext = downloadFormat === "image/png" ? "png" : "jpg";
    const baseName = fileName ? fileName.replace(/\.[^.]+$/, "") : "passport_photo";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_passport.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [imgEl, scale, rotation, offsetX, offsetY, baseScale, downloadFormat, fileName]);

  const resetAll = () => {
    setScale(1);
    setRotation(0);
    setOffsetX(0);
    setOffsetY(0);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0f1117 0%, #1a1d2e 40%, #0f1117 100%)",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      color: "#e8e8ee",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px 16px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; }
        input[type=range] {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 6px; border-radius: 3px;
          background: #2a2d3e; outline: none; cursor: pointer;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: #6c8aff; border: 2px solid #fff;
          cursor: grab; box-shadow: 0 2px 8px rgba(108,138,255,0.4);
        }
        input[type=range]::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: #6c8aff; border: 2px solid #fff;
          cursor: grab; box-shadow: 0 2px 8px rgba(108,138,255,0.4);
        }
        .upload-zone { transition: all 0.3s ease; }
        .upload-zone:hover { border-color: #6c8aff !important; background: rgba(108,138,255,0.06) !important; }
        .btn { transition: all 0.2s ease; cursor: pointer; border: none; outline: none; }
        .btn:hover { transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 28, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: "linear-gradient(135deg, #6c8aff, #a855f7)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700, color: "#fff"
          }}>P</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff" }}>
            Passport Photo Tool
          </h1>
        </div>
        <p style={{ fontSize: 13, color: "#8b8fa3", fontFamily: "'JetBrains Mono', monospace" }}>
          {TARGET_W}×{TARGET_H}px &middot; {PPI} PPI &middot; {(INCHES_W).toFixed(2)}" × {(INCHES_H).toFixed(2)}"
        </p>
      </div>

      <div style={{
        display: "flex", flexWrap: "wrap", gap: 24,
        justifyContent: "center", maxWidth: 820, width: "100%"
      }}>
        {/* Left: Preview */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          {!image ? (
            <label
              className="upload-zone"
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
              style={{
                width: previewW, height: previewH,
                border: `2px dashed ${isDragOver ? '#6c8aff' : '#3a3d52'}`,
                borderRadius: 12,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 12,
                cursor: "pointer",
                background: isDragOver ? "rgba(108,138,255,0.08)" : "rgba(26,29,46,0.6)",
                fontFamily: "'DM Sans', sans-serif"
              }}
            >
              <input type="file" accept="image/*" onChange={onFileSelect} style={{ display: "none" }} />
              <div style={{ fontSize: 40, opacity: 0.4 }}>📷</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#9ca0b8" }}>
                Drop photo here
              </div>
              <div style={{ fontSize: 12, color: "#5e6175" }}>or click to browse</div>
            </label>
          ) : (
            <div style={{ position: "relative" }}>
              <canvas
                ref={previewRef}
                width={previewW}
                height={previewH}
                onMouseDown={handleMouseDown}
                onTouchStart={handleMouseDown}
                style={{
                  borderRadius: 10,
                  cursor: dragging ? "grabbing" : "grab",
                  border: "2px solid #2a2d3e",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                  touchAction: "none"
                }}
              />
              <div style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                background: "rgba(15,17,23,0.85)", backdropFilter: "blur(8px)",
                borderRadius: 6, padding: "4px 10px",
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                color: "#8b8fa3", whiteSpace: "nowrap",
                pointerEvents: "none"
              }}>
                drag to reposition
              </div>
            </div>
          )}

          {image && (
            <div style={{
              display: "flex", gap: 8, fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace", color: "#5e6175"
            }}>
              <span>Output: {TARGET_W}×{TARGET_H}px</span>
              <span>·</span>
              <span>{PPI} PPI</span>
            </div>
          )}
        </div>

        {/* Right: Controls */}
        {image && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 16,
            width: 260, fontFamily: "'DM Sans', sans-serif"
          }}>
            {/* File info */}
            <div style={{
              background: "rgba(26,29,46,0.6)", borderRadius: 10,
              padding: "12px 16px", border: "1px solid #2a2d3e"
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#6c8aff", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Source
              </div>
              <div style={{ fontSize: 13, color: "#c8cbdb", wordBreak: "break-all" }}>
                {fileName}
              </div>
              {imgEl && (
                <div style={{ fontSize: 11, color: "#5e6175", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
                  {imgEl.width} × {imgEl.height}px original
                </div>
              )}
            </div>

            {/* Scale */}
            <div style={{
              background: "rgba(26,29,46,0.6)", borderRadius: 10,
              padding: "14px 16px", border: "1px solid #2a2d3e"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#c8cbdb" }}>Scale</span>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#6c8aff" }}>
                  {(scale * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range" min="0.3" max="3" step="0.01"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
              />
            </div>

            {/* Rotation */}
            <div style={{
              background: "rgba(26,29,46,0.6)", borderRadius: 10,
              padding: "14px 16px", border: "1px solid #2a2d3e"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#c8cbdb" }}>Rotation</span>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "#6c8aff" }}>
                  {rotation.toFixed(1)}°
                </span>
              </div>
              <input
                type="range" min="-180" max="180" step="0.5"
                value={rotation}
                onChange={(e) => setRotation(parseFloat(e.target.value))}
              />
            </div>

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { label: "−90°", action: () => setRotation(r => ((r - 90 + 180) % 360) - 180) },
                { label: "+90°", action: () => setRotation(r => ((r + 90 + 180) % 360) - 180) },
                { label: "Reset", action: resetAll },
              ].map((btn, i) => (
                <button key={i} className="btn" onClick={btn.action} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8,
                  background: "#2a2d3e", color: "#9ca0b8",
                  fontSize: 12, fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif"
                }}>
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Upload new */}
            <label className="btn" style={{
              padding: "10px 0", borderRadius: 8, textAlign: "center",
              background: "rgba(108,138,255,0.1)", color: "#6c8aff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid rgba(108,138,255,0.2)"
            }}>
              Upload New Photo
              <input type="file" accept="image/*" onChange={onFileSelect} style={{ display: "none" }} />
            </label>

            {/* Divider */}
            <div style={{ height: 1, background: "#2a2d3e" }} />

            {/* Format & Download */}
            <div style={{
              background: "rgba(26,29,46,0.6)", borderRadius: 10,
              padding: "14px 16px", border: "1px solid #2a2d3e"
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#c8cbdb", marginBottom: 10 }}>
                Download Format
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "JPEG", value: "image/jpeg" },
                  { label: "PNG", value: "image/png" },
                ].map((fmt) => (
                  <button key={fmt.value} className="btn" onClick={() => setDownloadFormat(fmt.value)} style={{
                    flex: 1, padding: "8px 0", borderRadius: 8,
                    background: downloadFormat === fmt.value ? "#6c8aff" : "#2a2d3e",
                    color: downloadFormat === fmt.value ? "#fff" : "#9ca0b8",
                    fontSize: 13, fontWeight: 600,
                    fontFamily: "'DM Sans', sans-serif"
                  }}>
                    {fmt.label}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={renderFinal} style={{
                width: "100%", padding: "12px 0", borderRadius: 8,
                background: "linear-gradient(135deg, #6c8aff, #a855f7)",
                color: "#fff", fontSize: 14, fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
                boxShadow: "0 4px 16px rgba(108,138,255,0.3)"
              }}>
                ↓ Download Passport Photo
              </button>
            </div>

            {/* Specs reminder */}
            <div style={{
              fontSize: 11, color: "#5e6175", lineHeight: 1.6,
              fontFamily: "'JetBrains Mono', monospace",
              background: "rgba(26,29,46,0.4)", borderRadius: 8,
              padding: "10px 12px", border: "1px solid #1e2030"
            }}>
              <div style={{ color: "#8b8fa3", fontWeight: 500, marginBottom: 4 }}>Passport Spec</div>
              <div>Min: 415 × 533px</div>
              <div>Max: 444 × 585px</div>
              <div>Target: {TARGET_W} × {TARGET_H}px</div>
              <div>Resolution: {PPI} PPI</div>
              <div>Print: {INCHES_W.toFixed(2)}" × {INCHES_H.toFixed(2)}"</div>
            </div>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
