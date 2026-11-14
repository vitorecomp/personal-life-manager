import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FuiBadge, FuiBatteryCapsule, FuiFigureRow, FuiPanel, FUI_TOKENS } from '@hermes/ui';
import { apiGet, unwrapList } from '../api/client';

export function CoursesPage() {
  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/courses');
        return unwrapList<any>(res, ['courses']);
      } catch {
        return [];
      }
    },
  });

  const displayCourses =
    courses.length > 0
      ? courses
      : [
          {
            id: 'seed-course-1',
            title: 'Distributed Systems & Consensus Engineering',
            provider: 'MIT 6.824',
            completed_lessons: 6,
            total_lessons: 10,
          },
        ];

  return (
    <div
      data-testid="courses-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        headerTitle="COURSE TRACKER // SYLLABUS, YOUTUBE AI & SPACED REVIEWS"
        headerProps={{
          title: 'COURSE TRACKER // SYLLABUS, YOUTUBE AI & SPACED REVIEWS',
          code: 'MOD_10',
          accent: 'cyan',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {displayCourses.map((course: any, idx: number) => {
            const total = Math.max(1, Number(course.total_lessons ?? 10));
            const done = Math.max(0, Number(course.completed_lessons ?? 5));
            const pct = Math.round((done / total) * 100);
            return (
              <FuiFigureRow
                key={course.id ?? idx}
                code={`CRS.0${idx + 1}`}
                title={String(course.title || 'Course Module')}
                subtitle={`${done}/${total} LESSONS COMPLETED`}
                rightSlot={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FuiBadge tone="cyan">{pct}%</FuiBadge>
                    <FuiBatteryCapsule progressPct={pct} segments={4} />
                  </div>
                }
              />
            );
          })}
        </div>
      </FuiPanel>
    </div>
  );
}
