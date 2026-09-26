'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, BookOpen, CalendarDays, Shield, UserRound} from 'lucide-react';
import type {Profile} from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';
import ProfileCoverArtwork from '@/components/ProfileCoverArtwork';
import {resolveProfileTheme} from '@/lib/profile-themes';
import '../../profile/profile.css';
import './public-profile.css';

export default function PublicUserProfile({profile}:{profile:Profile}) {
  const router = useRouter();
  const theme = resolveProfileTheme(profile.id, profile.profileTheme);
  const date = new Date(profile.created_at);
  const joined = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', {year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Shanghai'}).format(date) : '暂未公开';
  return <main className="public-profile-page" data-testid="public-profile">
    <div className="public-profile-shell">
      <nav className="public-profile-nav" aria-label="个人主页导航">
        <button type="button" onClick={() => {if (window.history.length > 1) router.back(); else router.replace('/');}}><ArrowLeft size={20}/>返回</button>
        <span>书友主页</span>
        <Link href="/" aria-label="返回书库"><BookOpen size={20}/></Link>
      </nav>
      <article className="profile-card public-profile-card" data-profile-theme={theme}>
        <div className="profile-cover public-profile-cover"><ProfileCoverArtwork theme={theme}/></div>
        <header className="public-profile-identity">
          <UserAvatar user={profile} className="public-profile-avatar"/>
          <h1>{profile.username}</h1>
          <span className="public-profile-role">{profile.role === 'admin' ? <Shield size={14}/> : <UserRound size={14}/>} {profile.role === 'admin' ? '管理员' : '书友'}</span>
        </header>
        <section className="public-profile-info" aria-labelledby="public-profile-info-title">
          <h2 id="public-profile-info-title">基本资料</h2>
          <dl>
            <div><dt><UserRound size={17}/>昵称</dt><dd>{profile.username}</dd></div>
            <div><dt><CalendarDays size={17}/>加入时间</dt><dd><time dateTime={Number.isFinite(date.getTime()) ? date.toISOString() : undefined}>{joined}</time></dd></div>
          </dl>
        </section>
      </article>
    </div>
  </main>;
}
