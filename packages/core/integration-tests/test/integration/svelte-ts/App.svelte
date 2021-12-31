<script lang="ts">
  export let name: string;
</script>

<div class="name">
  <h1 class="name-text">{name}</h1>
</div>

<style lang="scss">
  .name {
    background-color: black;
    &-text {
      color: white;
    }
  }
</style>