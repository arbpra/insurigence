import { useState, ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export default function DropDown({ children }: Props) {
  const [mobileToggle, setMobileToggle] = useState(false);

  const handelMobileToggle = () => {
    setMobileToggle(!mobileToggle);
  };

  return (
    <div>
      {children}
    </div>
  );
}