#!/usr/bin/env python3
"""
homebutton 과거 납부데이터 자동 다운로드 (주 1회)
매주 월요일 오전 9시 20분 자동 실행
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options

# 설정
HOMEBUTTON_URL = "https://app.homebutton.co.kr/pmcAdmin/GAURANTEEZ/pmcPayData"
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
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--window-size=1920,1080')

    prefs = {
        'download.default_directory': str(DOWNLOAD_PATH),
        'download.prompt_for_download': False,
        'safebrowsing.enabled': False
    }
    chrome_options.add_experimental_option('prefs', prefs)

    try:
        driver = webdriver.Chrome(options=chrome_options)
        log("✓ Chrome WebDriver 초기화 완료")
        return driver
    except Exception as e:
        log(f"✗ WebDriver 설정 실패: {e}")
        sys.exit(1)

def login(driver):
    """homebutton 로그인"""
    try:
        log("→ homebutton 로그인 시작...")
        driver.get("https://app.homebutton.co.kr/user/login")

        wait = WebDriverWait(driver, 10)

        email_input = wait.until(EC.presence_of_element_located((By.NAME, 'email')))
        email_input.clear()
        email_input.send_keys(LOGIN_EMAIL)
        log(f"  이메일 입력: {LOGIN_EMAIL}")

        password_input = driver.find_element(By.NAME, 'password')
        password_input.clear()
        password_input.send_keys(LOGIN_PASSWORD)
        log("  비밀번호 입력 완료")

        login_button = driver.find_element(By.XPATH, '//button[contains(text(), "로그인")]')
        login_button.click()

        time.sleep(3)
        wait.until(EC.url_changes("https://app.homebutton.co.kr/user/login"))

        log("✓ 로그인 완료")
        return True

    except Exception as e:
        log(f"✗ 로그인 실패: {e}")
        return False

def download_period(driver, start_month, end_month):
    """특정 기간 데이터 다운로드"""
    try:
        log(f"→ 데이터 조회: {start_month} ~ {end_month}")
        driver.get(HOMEBUTTON_URL)

        wait = WebDriverWait(driver, 10)
        time.sleep(2)

        # 시작 월 입력
        start_input = wait.until(EC.presence_of_element_located((By.XPATH, '//input[@placeholder*="시작"]')))
        start_input.clear()
        start_input.send_keys(f"{start_month}-01")
        log(f"  시작: {start_month}-01")

        time.sleep(1)

        # 종료 월 입력
        end_input = driver.find_element(By.XPATH, '//input[@placeholder*="종료"]')
        end_input.clear()
        end_input.send_keys(f"{end_month}-31")
        log(f"  종료: {end_month}-31")

        time.sleep(1)

        # 검색
        log("→ 데이터 조회 중...")
        search_button = driver.find_element(By.XPATH, '//button[contains(text(), "검색")]')
        search_button.click()

        time.sleep(5)

        # 다운로드
        try:
            download_btn = wait.until(EC.element_to_be_clickable((By.XPATH, '//button[contains(text(), "다운로드")] | //button[contains(text(), "Excel")]')))
            download_btn.click()
            log(f"✓ {start_month} ~ {end_month} 다운로드 완료")
        except:
            log(f"⚠ {start_month} ~ {end_month} 다운로드 버튼 미발견")

        time.sleep(2)
        return True

    except Exception as e:
        log(f"✗ 다운로드 실패 ({start_month} ~ {end_month}): {e}")
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
