#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""연체추이(Raw DATA) 누락 감시 — 맥(동기화 PC)과 무관하게 GitHub Actions에서 돌며, 회차 기록이 빠지면 Slack으로 알린다.

읽는 곳: OD 스프레드시트 '연체추이(Raw DATA)' 탭(gid 1477881084)의 공개 gviz 엔드포인트 (A:C = 일자·시각·기록시각만).
보내는 곳: 환경변수 SLACK_WEBHOOK_URL (GitHub Secrets). 없으면 결과를 로그에만 출력.

모드
  morning : 오늘 08:20 기준값이 있는지 + 어제 마감(24:00, 없으면 18:00)·어제 빠진 회차   — 08:50 KST
  evening : 오늘 18:00 마감 기록이 있는지 + 오늘 지금까지 빠진 회차                        — 18:45 KST
  auto    : 현재 KST 시각으로 morning/evening 판정
  test    : 현재 상태를 요약해 무조건 1건 전송 (연결 확인용)
문제가 없으면 아무것도 보내지 않는다(조용히 종료).
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from zoneinfo import ZoneInfo

SHEET_ID = "1fhp2DBul3tffFKexNXrFiduSoJ8g-8FLvpfXKaDBo2Q"
GID = "1477881084"
KST = ZoneInfo("Asia/Seoul")
SLOTS = ["08:20", "09:30", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "24:00"]
START = dt.date(2026, 10, 13)          # 기록 시작
START_24 = dt.date(2026, 10, 15)       # 24:00(23:30 회차) 시작
START_WEEKEND = dt.date(2026, 10, 17)  # 토·일 기록 시작
DASH = "https://hskang-coder.github.io/krg-ops-dashboard/"


def fetch_rows():
    url = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&gid={GID}"
           f"&range=A:C&headers=1&tq=SELECT%20*&_t={int(dt.datetime.now().timestamp())}")
    req = urllib.request.Request(url, headers={"User-Agent": "krg-odt-watch/1.0", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=40) as r:
        text = r.read().decode("utf-8", "replace")
    i, j = text.find("setResponse("), text.rfind(")")
    if i < 0 or j <= i:
        raise RuntimeError("gviz 응답 형식 오류")
    gv = json.loads(text[i + 12:j].rstrip(";"))
    out = set()
    for row in gv["table"]["rows"]:
        c = row.get("c") or []
        day = _ymd(c[0]) if len(c) > 0 else None
        slot = _hm(c[1]) if len(c) > 1 else None
        if day and slot:
            out.add((day, slot))
    return out


def _cell(c):
    if not c:
        return ""
    v = c.get("f")
    if v is None:
        v = c.get("v")
    return "" if v is None else str(v)


def _ymd(c):
    s = _cell(c)
    m = re.search(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", s)
    if m:
        return dt.date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"Date\((\d+),(\d+),(\d+)", s)
    return dt.date(int(m[1]), int(m[2]) + 1, int(m[3])) if m else None


def _hm(c):
    s = _cell(c)
    m = re.search(r"(\d{1,2}):(\d{2})", s)
    if m:
        return f"{int(m[1]):02d}:{m[2]}"
    m = re.search(r"Date\(\d+,\d+,\d+,(\d+),(\d+)", s)
    return f"{int(m[1]):02d}:{int(m[2]):02d}" if m else None


def expected(day):
    """그날 기대 회차 목록"""
    if day < START:
        return []
    if day < START_WEEKEND and day.weekday() >= 5:
        return []
    return [s for s in SLOTS if not (s == "24:00" and day < START_24)]


def lb(day):
    return f"{day.month}/{day.day}({'월화수목금토일'[day.weekday()]})"


def slot_lb(s):
    return "08:20" if s == "08:20" else ("9:30" if s == "09:30" else ("24:00 마감" if s == "24:00" else f"{int(s[:2])}시"))


def report(rows, now, mode):
    today = now.date()
    yday = today - dt.timedelta(days=1)
    have = lambda d, s: (d, s) in rows
    todays = sorted(s for (d, s) in rows if d == today)
    ydays = sorted(s for (d, s) in rows if d == yday)
    problems, notes = [], []

    if mode == "morning":
        if not have(today, "08:20"):
            problems.append(f"🛑 *{lb(today)} 08:20 기준값 기록 없음* — 오늘 기록: " + (", ".join(slot_lb(s) for s in todays) or "없음")
                            + "\n→ 맥이 꺼져 있거나 잠들어 있을 가능성. 덮개를 열고 전원을 연결하면 다음 회차가 대체 기준값으로 기록됩니다.")
        exp_y = expected(yday)
        if exp_y:
            miss_y = [s for s in exp_y if not have(yday, s)]
            miss_txt = ", ".join(slot_lb(s) for s in miss_y)
            if "24:00" in exp_y and not have(yday, "24:00"):
                last = ydays[-1] if ydays else None
                sev = "⚠️" if have(yday, "18:00") else "🛑"
                problems.append(f"{sev} *{lb(yday)} 마감(24:00) 기록 없음* — 마지막 회차 " + (slot_lb(last) if last else "없음")
                                + ("" if have(yday, "18:00") else " · 18:00 마감도 없음")
                                + (f"\n빠진 회차: {miss_txt}" if miss_y else ""))
            elif miss_y:
                notes.append(f"ℹ️ {lb(yday)} 빠진 회차: {miss_txt}")
    elif mode == "evening":
        if not have(today, "18:00"):
            last = todays[-1] if todays else None
            problems.append(f"🛑 *{lb(today)} 18:00 마감 기록 없음* — 마지막 회차 " + (slot_lb(last) if last else "없음")
                            + "\n→ 18:00 Slack 요약도 발송되지 않았습니다. 맥 상태를 확인해 주세요.")
        exp_t = [s for s in expected(today) if s not in ("24:00",)]
        miss_t = [s for s in exp_t if not have(today, s)]
        if miss_t and have(today, "18:00"):
            notes.append(f"ℹ️ {lb(today)} 빠진 회차: " + ", ".join(slot_lb(s) for s in miss_t))
    elif mode == "test":
        problems.append(f"✅ 감시 연결 확인 — {lb(today)} 기록 회차: " + (", ".join(slot_lb(s) for s in todays) or "없음")
                        + f" · {lb(yday)}: " + (", ".join(slot_lb(s) for s in ydays) or "없음"))
    return problems, notes


def post(text):
    hook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
    if not hook:
        print("[no SLACK_WEBHOOK_URL] 보낼 내용:\n" + text)
        return False
    req = urllib.request.Request(hook, data=json.dumps({"text": text}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        print("slack", r.status)
    return True


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else "auto").strip().lower()
    now = dt.datetime.now(KST)
    if mode == "auto":
        mode = "morning" if now.hour < 13 else "evening"
    rows = fetch_rows()
    problems, notes = report(rows, now, mode)
    print(f"mode={mode} now={now:%Y-%m-%d %H:%M} rows={len(rows)} problems={len(problems)} notes={len(notes)}")
    if not problems:
        for n in notes:
            print(n)
        print("정상 — 알림 없음")
        return
    head = "📡 *연체추이 누락 감시* (GitHub Actions · 맥과 무관)" if mode != "test" else "📡 *연체추이 누락 감시 — 테스트*"
    body = "\n".join(problems + notes)
    post(f"{head}\n{body}\n대시보드: {DASH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 감시 자체가 실패해도 조용히 죽지 않고 알린다 (웹훅 없으면 로그만)
        print("watch error:", repr(e))
        try:
            post(f"⚠️ 연체추이 누락 감시 실행 오류: {str(e)[:200]}")
        except Exception:
            pass
        sys.exit(0)
