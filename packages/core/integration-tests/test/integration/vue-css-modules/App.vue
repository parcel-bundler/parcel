<style module>
.red {
  color: red;
}
</style>

<style module="a">
.green {
  color: green;
}
</style>

<template>
<div>
  <p :class="$style.red">
    This should be red
  </p>
  <p :class="a.green">
    This should be green
  </p>
</div>
</template>

<script>
export default {
  created () {
    console.log(this.$style.red)
    // -> "_1VyoJ-uZOjlOxP7jWUy19_0"
    // an identifier generated based on filename and className.
  }
}
</script>
