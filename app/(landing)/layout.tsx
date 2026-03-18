"use client"
import { ReactNode, useEffect } from 'react';
import Header from '../(landing)/header/page';
import Footer from '../(landing)/footer/page';


interface LayoutProps {
    children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
    useEffect(() => {
        const disableRightClick = (e: MouseEvent) => {
            e.preventDefault();
        };

        // document.addEventListener('contextmenu', disableRightClick);

        return () => {
            // document.removeEventListener('contextmenu', disableRightClick);
        };
    }, []);

    return (
        <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: '#F5F7FA' }}>
            <Header></Header>
            {children}
            <Footer></Footer>
        </div>
    );
};

export default Layout;
