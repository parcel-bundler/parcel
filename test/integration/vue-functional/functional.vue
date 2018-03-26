<template functional>
  <div>
    <h2 :class="$style.red">{{ props.msg }}</h2>
    <slot></slot>
    <slot name="slot2"></slot>
    <div>Some <span>text</span></div>
    <div v-if="false">Not exist</div>
  </div>
</template>

<style module>
.red {
  color: red;
}
</style>
