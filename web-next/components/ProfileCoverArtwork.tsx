import type {ProfileTheme} from '@/lib/profile-themes';

export default function ProfileCoverArtwork({theme}: {theme: ProfileTheme}) {
  return <svg className="profile-cover-art" viewBox="0 0 680 190" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
    {theme === 'apricot' && <>
      <circle cx="546" cy="57" r="33" fill="currentColor" opacity=".23"/>
      <path d="M0 164Q180 92 352 147T680 125V190H0Z" fill="currentColor" opacity=".11"/>
      <path d="M238 190Q415 92 680 165M314 190Q490 121 680 182" fill="none" stroke="currentColor" strokeWidth="1" opacity=".25"/>
    </>}
    {theme === 'sage' && <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".35">
      <path d="M450 190Q501 87 618 20M567 190Q560 123 650 67"/>
      <path d="M493 115Q458 58 520 78Q524 108 493 115ZM531 78Q507 27 561 43Q563 72 531 78ZM566 51Q585 16 623 22Q603 57 566 51ZM574 123Q597 75 631 91Q616 130 574 123ZM567 151Q532 131 547 103Q577 117 567 151Z" fill="currentColor" stroke="none" opacity=".42"/>
      <circle cx="395" cy="68" r="47" opacity=".3"/>
    </g>}
    {theme === 'mist' && <>
      <circle cx="536" cy="55" r="25" fill="var(--profile-surface)" opacity=".7"/>
      <path d="M180 170L343 72 456 143 571 92 680 138V190H180Z" fill="currentColor" opacity=".13"/>
      <path d="M275 190L464 104 594 167 680 136V190Z" fill="currentColor" opacity=".13"/>
      <path d="M210 175Q340 153 478 176T710 170M313 184Q448 173 613 185" fill="none" stroke="var(--profile-surface)" strokeWidth="2" opacity=".8"/>
    </>}
    {theme === 'rose' && <>
      <g fill="currentColor" opacity=".13" transform="translate(543 87)">
        {[0,60,120,180,240,300].map(angle => <ellipse key={angle} cx="0" cy="-30" rx="23" ry="42" transform={`rotate(${angle})`}/>)}
      </g>
      <circle cx="543" cy="87" r="17" fill="var(--profile-surface)" opacity=".5"/>
      <path d="M283 190Q358 126 457 174M385 190Q460 136 605 174" fill="none" stroke="currentColor" strokeWidth="1" opacity=".23"/>
    </>}
  </svg>;
}
