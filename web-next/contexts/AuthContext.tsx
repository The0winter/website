'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {authApi,type Profile,type AuthUser} from '@/lib/api';
import {setLibraryUser} from '@/lib/library-cache';
interface AuthContextType {
 user:AuthUser|null;profile:Profile|null;loading:boolean;adminMode:boolean;
 setUser:(user:AuthUser|null)=>void;
 signUp:(email:string,password:string,username:string,role:'reader',code:string)=>Promise<{error:Error|null}>;
 register:(username:string,email:string,password:string,code:string)=>Promise<{error:Error|null}>;
 signIn:(email:string,password:string)=>Promise<{error:Error|null;user?:AuthUser}>;
 logout:()=>Promise<void>;
}
const AuthContext=createContext<AuthContextType|undefined>(undefined);
export function AuthProvider({children}:{children:ReactNode}) {
 const [user,setUser]=useState<AuthUser|null>(null),[profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(true);
 const accept=(user:AuthUser,profile:Profile)=>{setLibraryUser(user.id);setUser(user);setProfile(profile);localStorage.setItem('novelhub_user',user.id);};
 useEffect(()=>{
  let active=true;localStorage.removeItem('token');localStorage.removeItem('user');
  authApi.getSession().then(session=>{if(!active)return;if(session.user&&session.profile){setLibraryUser(session.user.id);setUser(session.user);setProfile(session.profile);localStorage.setItem('novelhub_user',session.user.id);}else {setLibraryUser(null);localStorage.removeItem('novelhub_user');}}).catch(()=>{if(active){setLibraryUser(null);setUser(null);setProfile(null);}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[]);
 const signUp:AuthContextType['signUp']=async(email,password,username,role,code)=>{try{const response=await authApi.signUp(email,password,username,role,code);accept(response.user,response.profile);return {error:null};}catch(e){return {error:e instanceof Error?e:new Error('注册失败')};}};
 const signIn:AuthContextType['signIn']=async(email,password)=>{try{const response=await authApi.signIn(email,password);accept(response.user,response.profile);return {error:null,user:response.user};}catch(e){return {error:e instanceof Error?e:new Error('登录失败')};}};
 const logout=async()=>{await authApi.logout();setLibraryUser(null);setUser(null);setProfile(null);for(const key of ['token','user','novelhub_user'])localStorage.removeItem(key);};
 const adminMode=!loading && user?.role==='admin';
 return <AuthContext.Provider value={{user,profile,loading,adminMode,setUser,signUp,signIn,logout,register:(username,email,password,code)=>signUp(email,password,username,'reader',code)}}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('AuthProvider is required');return value;}
