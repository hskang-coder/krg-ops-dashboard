#!/usr/bin/env python3
"""
homebutton 납부데이터 자동 정리/통합 스크립트
- 여러 xlsx 파일 병합
- 중복 제거
- 변경 사항 업데이트
- 통합 파일 생성
"""

import os
import sys
from pathlib import Path
from datetime import datetime
import pandas as pd
from openpyxl import load_workbook

# 설정
# 명시적 경로 사용 (환경에 따라 다를 수 있음)
def _resolve_rawdata_path():
    """실행 환경에 따라 Rawdata 폴더 경로를 동적으로 찾는다."""
    candidates = [Path('/Users/hwisookang/krg-ops-dashboard/Rawdata')]
    # Bash/세션 환경: 세션 ID가 매번 바뀌므로 동적으로 탐색
    candidates += sorted(Path('/sessions').glob('*/mnt/krg-ops-dashboard/Rawdata')) \
        if Path('/sessions').exists() else []
    for c in candidates:
        try:
            if c.exists():
                return c
        except (PermissionError, OSError):
            continue
    return candidates[0]

RAWDATA_PATH = _resolve_rawdata_path()
OUTPUT_FILE = RAWDATA_PATH / '통합_납부데이터.xlsx'
LOG_FILE = RAWDATA_PATH / 'consolidation_log.txt'

def log(message):
    """로그 기록"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {message}"
    print(log_message)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(log_message + '\n')

def consolidate_data():
    """모든 xlsx 파일 정리 및 통합"""
    log("=" * 60)
    log("납부데이터 통합 시작")
    log("=" * 60)

    try:
        # Rawdata 폴더의 모든 xlsx 파일 찾기
        xlsx_files = list(RAWDATA_PATH.glob('*.xlsx'))
        xlsx_files = [f for f in xlsx_files if f.name not in ['통합_납부데이터.xlsx']]

        if not xlsx_files:
            log("⚠ 처리할 xlsx 파일이 없습니다")
            return False

        log(f"→ 발견된 파일: {len(xlsx_files)}개")

        # 모든 데이터 읽기
        all_data = []
        for file in xlsx_files:
            try:
                log(f"→ 읽기 중: {file.name}")
                df = pd.read_excel(file, sheet_name=0)

                # 필수 컬럼 확인
                if '계약번호' not in df.columns:
                    log(f"⚠ 필수 컬럼 없음: {file.name}")
                    continue

                all_data.append(df)
                log(f"  ✓ {len(df):,}행 읽음")

            except Exception as e:
                log(f"✗ 읽기 실패: {file.name} - {e}")
                continue

        if not all_data:
            log("✗ 처리할 데이터가 없습니다")
            return False

        # 데이터 병합
        log("→ 데이터 병합 중...")
        combined = pd.concat(all_data, ignore_index=True)
        log(f"  병합 전: {sum(len(d) for d in all_data):,}행")

        # 중복 제거 (계약번호 + 납부번호 + 납기일 기준으로 최신 데이터만 유지)
        log("→ 중복 제거 중...")

        # 추적 키 생성 (계약번호 + 납부번호 또는 청구서명)
        if '납부번호' in combined.columns:
            combined['_key'] = combined['계약번호'].astype(str) + '_' + combined['납부번호'].astype(str)
        elif '청구서명' in combined.columns:
            combined['_key'] = combined['계약번호'].astype(str) + '_' + combined['청구서명'].astype(str)
        else:
            combined['_key'] = combined['계약번호'].astype(str)

        # 최신 데이터만 유지 (날짜 기준 또는 마지막 행)
        if '납기일' in combined.columns:
            combined['납기일'] = pd.to_datetime(combined['납기일'], errors='coerce')
            combined = combined.sort_values('납기일', ascending=False)

        before_dedup = len(combined)
        combined = combined.drop_duplicates(subset=['_key'], keep='first')
        after_dedup = len(combined)

        log(f"  중복 제거: {before_dedup:,}행 → {after_dedup:,}행 ({before_dedup - after_dedup:,}개 제거)")

        # 추적 키 제거
        combined = combined.drop(columns=['_key'])

        # 컬럼 순서 정렬 (번호를 첫 번째로)
        if '번호' in combined.columns:
            cols = ['번호'] + [c for c in combined.columns if c != '번호']
            combined = combined[cols]

        # 통합 파일 저장
        log("→ 통합 파일 저장 중...")
        combined.to_excel(OUTPUT_FILE, sheet_name='통합데이터', index=False)
        log(f"  ✓ 저장 완료: {OUTPUT_FILE.name}")
        log(f"  최종 행수: {len(combined):,}행, {len(combined.columns)}컬럼")

        log("=" * 60)
        log("✓ 통합 완료")
        log("=" * 60)
        return True

    except Exception as e:
        log(f"✗ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """메인 함수"""
    if not RAWDATA_PATH.exists():
        log(f"✗ Rawdata 폴더 없음: {RAWDATA_PATH}")
        return False

    success = consolidate_data()
    return success

if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
