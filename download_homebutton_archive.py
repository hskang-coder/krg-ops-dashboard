#!/usr/bin/env python3
"""
homebutton 과거 납부데이터 자동 다운로드 (주 1회)
매주 월요일 오전 9시 20분 자동 실행
"""

import os
import sys
import json
import time
import calendar
from datetime import datetime, timedelta
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options

# 설정
HOMEBUTTON_URL = "https://app.homebutton.co.kr/pmcAdmin/GAURANTEEZ/pmcPayData"
LOGIN_URL = "https://app.homebutton.co.kr/login"  # 2026.07 사이트 개편: /user/login → /login
LOGIN_EMAIL = os.environ.get('HOMEBUTTON_EMAIL', 'hskang@krggroup.co.kr')
LOGIN_PASSWORD = os.environ.get('HOMEBUTTON_PASSWORD', 'hskang!1234')

HOME = os.path.expanduser('~')
DOWNLOAD_PATH = Path(HOME) / 'krg-ops-dashboard' / 'Rawdata'
LOG_FILE = DOWNLOAD_PATH / 'download_archive_log.txt'
CONFIG_FILE = DOWNLOAD_PATH / 'archive_config.json'

DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)

# 과거 데이터 범위: 2019.01 ~ 2026.03
ARCHIVE_PERIODS = [
    ('2026-01', '2026-03'),  # 0주차
    ('2025-10', '2025-12'),  # 1주차
    ('2025-07', '2025-09'),  # 2주차
    ('2025-04', '2025-06'),  # 3주차
    ('2025-01', '2025-03'),  # 4주차
    ('2024-10', '2024-12'),  # 5주차
    ('2024-07', '2024-09'),  # 6주차
    ('2024-04', '2024-06'),  # 7주차
    ('2024-01', '2024-03'),  # 8주차
    ('2023-10', '2023-12'),  # 9주차
    ('2023-07', '2023-09'),  # 10주차
    ('2023-04', '2023-06'),  # 11주차
    ('2023-01', '2023-03'),  # 12주차
    ('2022-10', '2022-12'),  # 13주차
    ('2022-07', '2022-09'),  # 14주차
    ('2022-04', '2022-06'),  # 15주차
    ('2022-01', '2022-03'),  # 16주차
    ('2021-10', '2021-12'),  # 17주차
    ('2021-07', '2021-09'),  # 18주차
    ('2021-04', '2021-06'),  # 19주차
    ('2021-01', '2021-03'),  # 20주차
    ('2020-10', '2020-12'),  # 21주차
    ('2020-07', '2020-09'),  # 22주차
    ('2020-04', '2020-06'),  # 23주차
    ('2020-01', '2020-03'),  # 24주차
    ('2019-10', '2019-12'),  # 25주차
    ('2019-07', '2019-09'),  # 26주차
    ('2019-04', '2019-06'),  # 27주차
    ('2019-01', '2019-03'),  # 28주차
]

def log(message):
    """로그 기록"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {message}"
    print(log_message)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(log_message + '\n')

def load_config():
    """설정 파일 로드"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'current_week': 0}

def save_config(config):
    """설정 파일 저장"""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2)

def setup_driver():
    """Selenium WebDriver 설정"""
    chrome_options = Options()
    chrome_options.add_argument('--headless=new')  # 구 headless는 파일 다운로드가 차단됨
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--window-size=1920,1080')
    # 대용량 조회 시 렌더러 메모리 부족으로 브라우저가 종료되는 것을 완화
    chrome_options.add_argument('--js-flags=--max-old-space-size=4096')
    chrome_options.add_argument('--disable-extensions')
    chrome_options.add_argument('--blink-settings=imagesEnabled=false')

    prefs = {
        'download.default_directory': str(DOWNLOAD_PATH),
        'download.prompt_for_download': False,
        'safebrowsing.enabled': False
    }
    chrome_options.add_experimental_option('prefs', prefs)

    try:
        driver = webdriver.Chrome(options=chrome_options)
        # headless 환경에서 다운로드를 명시적으로 허용
        for cmd in ('Page.setDownloadBehavior', 'Browser.setDownloadBehavior'):
            try:
                driver.execute_cdp_cmd(cmd, {
                    'behavior': 'allow',
                    'downloadPath': str(DOWNLOAD_PATH),
                })
            except Exception as e:
                log(f"  ⚠ {cmd} 설정 생략: {type(e).__name__}")
        log("✓ Chrome WebDriver 초기화 완료 (다운로드 경로: %s)" % DOWNLOAD_PATH)
        return driver
    except Exception as e:
        log(f"✗ WebDriver 설정 실패: {e}")
        sys.exit(1)

def _visible(driver, css):
    """표시된 요소만 반환"""
    return [e for e in driver.find_elements(By.CSS_SELECTOR, css) if e.is_displayed()]


def set_input_value(driver, element, value):
    """Vue/Nuxt 바인딩이 인식하도록 값 설정 + 이벤트 발생"""
    driver.execute_script("""
        const el = arguments[0], v = arguments[1];
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input',  {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
    """, element, value)


def login(driver):
    """homebutton 로그인 (2026.07 개편 페이지 기준)"""
    try:
        log("→ homebutton 로그인 시작...")
        driver.get(LOGIN_URL)

        WebDriverWait(driver, 20).until(
            lambda d: len(_visible(d, 'input[type=email]')) > 0)

        email_input = _visible(driver, 'input[type=email]')[0]
        email_input.clear()
        email_input.send_keys(LOGIN_EMAIL)
        log(f"  이메일 입력: {LOGIN_EMAIL}")

        password_input = _visible(driver, 'input[type=password]')[0]
        password_input.clear()
        password_input.send_keys(LOGIN_PASSWORD)
        log("  비밀번호 입력 완료")

        driver.find_element(By.ID, 'loginbut').click()

        WebDriverWait(driver, 20).until(lambda d: '/login' not in d.current_url)
        log(f"✓ 로그인 완료 (이동: {driver.current_url})")
        return True

    except Exception as e:
        log(f"✗ 로그인 실패: {type(e).__name__} {e}")
        return False

def month_last_day(month_str):
    """'2026-03' → '2026-03-31'"""
    y, m = (int(x) for x in month_str.split('-'))
    return f"{month_str}-{calendar.monthrange(y, m)[1]:02d}"


def wait_for_download(before, timeout=180):
    """새 파일이 완전히 내려올 때까지 대기 (.crdownload 제외)"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        current = {p for p in DOWNLOAD_PATH.iterdir() if p.is_file()}
        new = [p for p in current - before if not p.name.endswith('.crdownload')]
        if new:
            newest = max(new, key=lambda p: p.stat().st_mtime)
            size = -1
            # 파일 크기가 안정될 때까지 대기
            for _ in range(30):
                s = newest.stat().st_size
                if s == size and s > 0:
                    return newest
                size = s
                time.sleep(1)
            return newest
        time.sleep(2)
    return None


def download_period(driver, start_month, end_month):
    """특정 기간 데이터 조회 후 엑셀 다운로드"""
    try:
        start_date = f"{start_month}-01"
        end_date = month_last_day(end_month)
        log(f"→ 데이터 조회: {start_date} ~ {end_date}")

        driver.get(HOMEBUTTON_URL)
        wait = WebDriverWait(driver, 30)
        wait.until(EC.presence_of_element_located(
            (By.XPATH, '//input[@placeholder="검색 시작일"]')))
        time.sleep(3)

        start_input = driver.find_element(By.XPATH, '//input[@placeholder="검색 시작일"]')
        end_input = driver.find_element(By.XPATH, '//input[@placeholder="검색 종료일"]')
        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", start_input)

        set_input_value(driver, start_input, start_date)
        set_input_value(driver, end_input, end_date)
        time.sleep(1)
        log(f"  기간 설정 확인: {start_input.get_attribute('value')} ~ "
            f"{end_input.get_attribute('value')}")

        # 검색
        log("→ 데이터 조회 중...")
        driver.find_element(By.XPATH, '//button[contains(@class,"last-btn2")]').click()
        time.sleep(15)

        # 다운로드
        before = {p for p in DOWNLOAD_PATH.iterdir() if p.is_file()}
        btns = [b for b in driver.find_elements(
            By.XPATH, '//button[contains(normalize-space(.), "정보 다운로드")]')
            if b.is_displayed()]
        if not btns:
            log("✗ '정보 다운로드' 버튼 미발견")
            return False

        driver.execute_script("arguments[0].scrollIntoView({block:'center'})", btns[0])
        driver.execute_script("arguments[0].click()", btns[0])
        log("  '정보 다운로드' 클릭")
        time.sleep(4)

        # 항목 선택 패널: '전체선택' → '완료'
        def click_by_text(text, wait_sec=15):
            end = time.time() + wait_sec
            while time.time() < end:
                els = [b for b in driver.find_elements(
                    By.XPATH, f'//button[normalize-space(.)="{text}"]'
                              f' | //a[normalize-space(.)="{text}"]'
                              f' | //span[normalize-space(.)="{text}"]')
                    if b.is_displayed()]
                if els:
                    driver.execute_script("arguments[0].click()", els[0])
                    log(f"  '{text}' 클릭")
                    return True
                time.sleep(1)
            log(f"  ⚠ '{text}' 버튼 미발견")
            return False

        # 전체선택(모든 컬럼)은 렌더러 메모리 초과로 브라우저가 죽는 사례가 있어
        # 기본 선택 상태 그대로 '완료'만 클릭한다.
        if os.environ.get('HB_SELECT_ALL') == '1':
            if click_by_text('전체선택'):
                time.sleep(2)
        if not click_by_text('완료'):
            return False
        time.sleep(5)

        downloaded = wait_for_download(before)
        if not downloaded:
            visible = [(b.text or '').strip() for b in driver.find_elements(By.TAG_NAME, 'button')
                       if b.is_displayed() and (b.text or '').strip()]
            log(f"✗ 다운로드 파일 미생성. 화면 버튼: {visible[:20]}")
            return False

        target = DOWNLOAD_PATH / f"납부데이터_아카이브_{start_month}_{end_month}{downloaded.suffix}"
        if target.exists():
            target = DOWNLOAD_PATH / (f"납부데이터_아카이브_{start_month}_{end_month}"
                                      f"_{datetime.now():%Y%m%d}{downloaded.suffix}")
        downloaded.rename(target)
        log(f"✓ {start_month} ~ {end_month} 다운로드 완료: {target.name} "
            f"({target.stat().st_size:,} bytes)")
        return True

    except Exception as e:
        log(f"✗ 다운로드 실패 ({start_month} ~ {end_month}): {type(e).__name__} {e}")
        return False

def main():
    """메인 실행 함수"""
    log("=" * 60)
    log("homebutton 과거 데이터 주간 다운로드 시작")
    log("=" * 60)

    driver = None
    try:
        # 설정 로드
        config = load_config()
        current_week = config.get('current_week', 0)

        if current_week >= len(ARCHIVE_PERIODS):
            log("✓ 모든 과거 데이터 다운로드 완료!")
            log(f"  (총 {len(ARCHIVE_PERIODS)}주차 완료)")
            return True

        # 현재 주차 정보
        start_month, end_month = ARCHIVE_PERIODS[current_week]
        log(f"→ 현재 주차: {current_week} / {len(ARCHIVE_PERIODS)-1}")
        log(f"  대상: {start_month} ~ {end_month}")

        driver = setup_driver()

        if not login(driver):
            log("✗ 스크립트 중단: 로그인 실패")
            return False

        if not download_period(driver, start_month, end_month):
            log("⚠ 다운로드 실패, 다음 주에 재시도")
            return False

        # 설정 업데이트 (다음 주차)
        config['current_week'] = current_week + 1
        save_config(config)

        next_week = current_week + 1
        if next_week < len(ARCHIVE_PERIODS):
            next_start, next_end = ARCHIVE_PERIODS[next_week]
            log(f"→ 다음 주차 예정: {next_start} ~ {next_end}")
        else:
            log("→ 다음 주차: 완료 예정")

        log("=" * 60)
        log("✓ 작업 완료")
        log("=" * 60)
        return True

    except KeyboardInterrupt:
        log("⚠ 사용자에 의해 중단됨")
        return False
    except Exception as e:
        log(f"✗ 예기치 않은 오류: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        if driver:
            driver.quit()
            log("✓ WebDriver 종료")

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
