#!/usr/bin/env python3
"""
homebutton 납부데이터 자동 다운로드 스크립트
매일 평일 오전 9시 20분 자동 실행
"""

import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Selenium 설정
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options

# 설정
HOMEBUTTON_URL = "https://app.homebutton.co.kr/pmcAdmin/GAURANTEEZ/pmcPayData"
LOGIN_EMAIL = os.environ.get('HOMEBUTTON_EMAIL', 'hskang@krggroup.co.kr')
LOGIN_PASSWORD = os.environ.get('HOMEBUTTON_PASSWORD', 'hskang!1234')

# 홈 경로 동적 설정
HOME = os.path.expanduser('~')
DOWNLOAD_PATH = Path(HOME) / 'krg-ops-dashboard' / 'Rawdata'
LOG_FILE = DOWNLOAD_PATH / 'download_log.txt'

# 다운로드 폴더 생성
DOWNLOAD_PATH.mkdir(parents=True, exist_ok=True)

def log(message):
    """로그 기록"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {message}"
    print(log_message)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(log_message + '\n')

def setup_driver():
    """Selenium WebDriver 설정"""
    chrome_options = Options()

    # 헤드리스 모드 (UI 없이 실행)
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--window-size=1920,1080')

    # 다운로드 경로 설정
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

        # 이메일 입력
        email_input = wait.until(EC.presence_of_element_located((By.NAME, 'email')))
        email_input.clear()
        email_input.send_keys(LOGIN_EMAIL)
        log(f"  이메일 입력: {LOGIN_EMAIL}")

        # 비밀번호 입력
        password_input = driver.find_element(By.NAME, 'password')
        password_input.clear()
        password_input.send_keys(LOGIN_PASSWORD)
        log("  비밀번호 입력 완료")

        # 로그인 버튼 클릭
        login_button = driver.find_element(By.XPATH, '//button[contains(text(), "로그인")]')
        login_button.click()

        # 로그인 완료 대기
        time.sleep(3)
        wait.until(EC.url_changes("https://app.homebutton.co.kr/user/login"))

        log("✓ 로그인 완료")
        return True

    except Exception as e:
        log(f"✗ 로그인 실패: {e}")
        return False

def download_data(driver):
    """납부데이터 다운로드 (최근 3개월)"""
    try:
        from datetime import datetime, timedelta

        log("→ 납부데이터 페이지 접근...")
        driver.get(HOMEBUTTON_URL)

        wait = WebDriverWait(driver, 10)
        time.sleep(2)

        # 조회기간 설정 (최근 3개월)
        log("→ 조회기간 설정 중...")

        # 날짜 계산: 최근 3개월
        today = datetime.now()
        start_date = today - timedelta(days=90)  # 약 3개월

        start_date_str = start_date.strftime('%Y-%m-%d')
        today_str = today.strftime('%Y-%m-%d')

        # 시작일 입력
        start_date_input = wait.until(EC.presence_of_element_located((By.XPATH, '//input[@placeholder*="시작"]')))
        start_date_input.clear()
        start_date_input.send_keys(start_date_str)
        log(f"  시작날짜: {start_date_str}")

        time.sleep(1)

        # 종료일 입력
        end_date_input = driver.find_element(By.XPATH, '//input[@placeholder*="종료"]')
        end_date_input.clear()
        end_date_input.send_keys(today_str)
        log(f"  종료날짜: {today_str}")

        time.sleep(1)

        # 검색 버튼 클릭
        log("→ 데이터 조회 중...")
        search_button = driver.find_element(By.XPATH, '//button[contains(text(), "검색")]')
        search_button.click()

        # 데이터 로드 대기
        time.sleep(5)

        # 다운로드 버튼 찾기 및 클릭
        log("→ 다운로드 중...")

        # 여러 다운로드 방식 시도
        try:
            # 방식 1: Excel 다운로드 버튼
            download_btn = wait.until(EC.element_to_be_clickable((By.XPATH, '//button[contains(text(), "다운로드")] | //button[contains(text(), "Excel")]')))
            download_btn.click()
        except:
            try:
                # 방식 2: 우측 상단 메뉴
                menu_btn = driver.find_element(By.XPATH, '//button[@title*="다운로드"]')
                menu_btn.click()
            except:
                log("⚠ 다운로드 버튼을 찾을 수 없음 - 데이터 추출 시도 중...")
                return extract_table_data(driver)

        # 다운로드 완료 대기
        time.sleep(3)

        # 가장 최근 다운로드 파일 확인
        files = sorted(DOWNLOAD_PATH.glob('*.xlsx'), key=os.path.getmtime, reverse=True)
        if files:
            log(f"✓ 다운로드 완료: {files[0].name}")
            return True
        else:
            log("⚠ 다운로드 파일을 찾을 수 없음")
            return False

    except Exception as e:
        log(f"✗ 다운로드 실패: {e}")
        import traceback
        traceback.print_exc()
        return False

def extract_table_data(driver):
    """테이블 데이터 추출 (다운로드 실패 시 대체 방안)"""
    try:
        log("→ 테이블 데이터 추출 중...")

        # 추가 구현 필요 - 테이블 HTML 파싱 및 Excel 생성
        log("⚠ 테이블 추출 기능 미구현")
        return False

    except Exception as e:
        log(f"✗ 테이블 추출 실패: {e}")
        return False

def main():
    """메인 실행 함수"""
    log("=" * 60)
    log("homebutton 납부데이터 자동 다운로드 시작")
    log("=" * 60)

    driver = None
    try:
        driver = setup_driver()

        if not login(driver):
            log("✗ 스크립트 중단: 로그인 실패")
            return False

        if not download_data(driver):
            log("⚠ 다운로드 완료했으나 검증 필요")
            return False

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
