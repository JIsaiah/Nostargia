import { Canvas } from "@react-three/fiber";
import { useState, useEffect } from "react";
import { Experience } from "./components/canvas/Experience";
import { Effects } from "./components/canvas/effects/Effects";
import { UI } from "./components/ui/UI";
import { Leva, useControls } from "leva";
import { useStarStore } from './store/useStarStore';
import { LoginModal } from './components/ui/modals/LoginModal';
import { LoginSuccessScreen } from './components/ui/screens/LoginSuccessScreen';
import { RegisterModal } from './components/ui/modals/RegisterModal';
import { RegisterSuccessScreen } from './components/ui/screens/RegisterSuccessScreen';
import { ForgotPasswordModal } from './components/ui/modals/ForgotPasswordModal';

import { supabase } from './supabaseClient';

import { useUserStore } from './store/useUserStore';

function App() {
  // Zustand storeから星のデータと追加関数を取得
  const { stars, addStar, fetchStars, subscribeToStars, focusTarget } = useStarStore();
  // ユーザー情報ストア
  const { setUser, setSession } = useUserStore();

  // Dummy control to ensure Leva panel appears
  useControls({ debugPanel: true });

  // 起動時にsupabaseから星のデータを読み込む
  useEffect(() => {
    fetchStars();
    // 他デバイスからの星追加をリアルタイム同期
    const unsubscribe = subscribeToStars();
    return () => unsubscribe();
  }, []);

  const [starClickHandler, setStarClickHandler] = useState(() => null);

  // 初期値を 'loading' にして、セッション確認が終わるまで何も表示しない
  const [phase, setPhase] = useState('loading');

  // Yozora 3Dシーンの表示（registerSuccessのグリッチ中にバックグラウンドで表示開始）
  const [showApp, setShowApp] = useState(false);

  // ★ セッション復元・監視ロジック ★
  useEffect(() => {
    // 1. 初回起動時のセッション取得
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        setUser({ id: session.user.id, email: session.user.email, created_at: session.user.created_at });
        // すでにログイン済みなら、ログイン画面などはスキップしてアプリを表示
        setShowApp(true);
        setPhase('app');
      } else {
        // セッションがなければログイン画面へ
        setPhase('login');
      }
    });

    // 2. 認証状態の変更を監視（ログイン・ログアウトなど）
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session ? { id: session.user.id, email: session.user.email, created_at: session.user.created_at } : null);

      // ログアウトされた場合はログイン画面に戻すなどの処理が必要ならここに書く
      if (!session) {
        setPhase('login');
        setShowApp(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setUser]);

  // 星クリックハンドラーをセットする関数
  const handleSetStarClickHandler = (handler) => {
    console.log('handleSetStarClickHandler called with:', handler);
    setStarClickHandler(() => handler);
  };

  return (
    <>

      {phase === 'loading' && null}

      {phase === 'login' && (
        <LoginModal
          onLogin={async (email, password) => {
            const { data, error } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            if (error) {
              if (error.message === 'Invalid login credentials') {
                throw new Error('メールアドレスまたはパスワードが間違っています。');
              }
              throw error;
            }
            setPhase('success');
          }}
          onRegister={() => {
            setPhase('register');
          }}
          onForgotPassword={() => {
            setPhase('forgotPassword');
          }}
        />
      )}

      {phase === 'forgotPassword' && (
        <ForgotPasswordModal
          onBackToLogin={() => setPhase('login')}
          onSubmitEmail={async (email) => {
            const { error } = await supabase.auth.signInWithOtp({
              email,
              options: { shouldCreateUser: false },
            });
            if (error) throw error;
          }}
          onSubmitCode={async (email, code) => {
            const { error } = await supabase.auth.verifyOtp({
              email,
              token: code,
              type: 'email',
            });
            if (error) throw error;
          }}
          onSubmitNewPassword={async (email, code, password) => {
            const { error } = await supabase.auth.updateUser({
              password: password
            });
            if (error) throw error;
            setShowApp(true);
            setPhase('app');
          }}
        />
      )}

      {phase === 'register' && (
        <RegisterModal
          onRegister={async (formData) => {
            // 1. Supabase Authでユーザー作成
            const { data: authData, error: authError } = await supabase.auth.signUp({
              email: formData.email,
              password: formData.password,
              options: {
                data: {
                  user_name: formData.userName, // メタデータとしても保存（任意）
                },
              },
            });

            if (authError) {
              if (authError.message === 'User already registered') {
                throw new Error('このメールアドレスは既に登録されています。');
              }
              throw authError;
            }
            if (!authData.user) throw new Error('ユーザー登録に失敗しました');

            // 2. public.t_account にプロフィール保存
            // 注意: RLSポリシーにより、自分のIDでしかinsertできないため、
            // triggerを使わない場合はここでのinsertが必要。
            const { error: dbError } = await supabase
              .from('t_account')
              .insert([
                {
                  user_id: authData.user.id,
                  user_name: formData.userName,
                  // birthdayは "YYYY-MM-DD" 文字列で来る前提
                  birthday: formData.birthday,
                },
              ]);

            if (dbError) {
              // プロフィール作成失敗時はロールバック的な処理が本来必要だが、
              // ここではエラーを表示するのみとする（Authユーザーは作成されてしまう点に注意）
              console.error('Profile creation failed:', dbError);
              throw new Error('プロフィールの作成に失敗しました: ' + dbError.message);
            }

            // 3. デフォルトタグを作成（#休日, #誕生日, #アニバーサリー）
            const { error: tagError } = await supabase
              .from('t_tag')
              .insert([
                { creator_id: authData.user.id, tag_name: '休日' },
                { creator_id: authData.user.id, tag_name: '誕生日' },
                { creator_id: authData.user.id, tag_name: 'アニバーサリー' },
              ]);
            if (tagError) {
              console.error('Default tags creation failed:', tagError);
              // タグ作成失敗は致命的ではないのでログのみ
            }

            console.log('Register success:', authData);
            setPhase('registerSuccess');
          }}
          onBackToLogin={() => setPhase('login')}
        />
      )}

      {phase === 'success' && (
        <LoginSuccessScreen
          onStartApp={() => {
            setShowApp(true);
          }}
          onGlitchDone={() => {
            setPhase('app');
          }}
        />
      )}

      {/* Yozora 3Dシーン（showAppがtrueになったら表示開始） */}
      {(showApp || phase === 'app') && (
        <>
          <Leva hidden />
          <Canvas
            camera={{ position: [0, 0, 10], fov: 50 }}
            style={{ width: '100%', height: '100%' }}
            dpr={[1, 1.5]}
          >
            <color attach="background" args={['#101020']} />
            <Experience userStars={stars} onStarClick={starClickHandler} focusTarget={focusTarget} />
            <Effects />
          </Canvas>
          <UI onSend={addStar} onStarClick={handleSetStarClickHandler} />
        </>
      )}

      {/* 登録成功画面（グリッチオーバーレイはYozoraの上に残る） */}
      {phase === 'registerSuccess' && (
        <RegisterSuccessScreen
          onStartApp={() => {
            // Yozoraをバックグラウンドで読み込み開始（グリッチの下で）
            setShowApp(true);
          }}
          onGlitchDone={() => {
            // グリッチ完全消失 → 通常のappフェーズへ
            setPhase('app');
          }}
        />
      )}
    </>
  );
}

export default App;

