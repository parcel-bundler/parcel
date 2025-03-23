"use client";

import { useState, startTransition } from "react";
import {like} from './actions';

export function Counter({likes}) {
  let [count, setCount] = useState(likes);
  let onClick = () => {
    startTransition(async () => {
      let newLikeCount = await like();
      setCount(newLikeCount);
    });
  };

  return <button onClick={onClick}>Count: {count}</button>;
}
