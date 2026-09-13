import {LoadingLogo, LoadingText} from '@/components/BrandLoading';
import './author.css';

export default function AuthorLoading() {
  return <div className="author-page author-loading" aria-label="正在打开作者主页" aria-busy="true">
    <LoadingLogo/>
    <p role="status"><LoadingText>正在打开作者主页</LoadingText></p>
  </div>;
}
