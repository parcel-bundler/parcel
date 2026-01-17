// javac Plugin.java
// native-image --shared -o libjavaplugin --native-compiler-options="-I$(pwd)"
import org.graalvm.nativeimage.c.struct.CField;
import org.graalvm.nativeimage.c.struct.CStruct;
import org.graalvm.word.PointerBase;
import org.graalvm.nativeimage.c.function.CFunction;
import org.graalvm.nativeimage.IsolateThread;
import org.graalvm.nativeimage.c.function.CEntryPoint;
import org.graalvm.nativeimage.c.type.CTypeConversion;
import org.graalvm.nativeimage.c.type.CCharPointer;
import org.graalvm.word.UnsignedWord;
import org.graalvm.word.WordFactory;
import org.graalvm.nativeimage.c.CContext;
import org.graalvm.nativeimage.StackValue;
import java.util.Collections;
import java.util.List;

// This class tells GraalVM where to find the C definitions
class ParcelContext implements CContext.Directives {
  @Override
  public List<String> getHeaderFiles() {
    // Use double quotes for local headers: "\"parcel.h\""
    return Collections.singletonList("\"plugin.h\"");
  }
}

@CContext(ParcelContext.class)
@CStruct("Buffer")
interface Buffer extends PointerBase {
  @CField("data")
  CCharPointer getData();

  @CField("len")
  UnsignedWord getLen();

  @CField("cap")
  UnsignedWord getCap();
}

class Asset {
  public long asset;

  public Asset(long asset) {
    this.asset = asset;
  }

  @CFunction("parcel_asset_get_content")
  public static native void parcel_asset_get_content(Buffer buffer, long asset);

  @CFunction("parcel_asset_set_content")
  public static native void parcel_asset_set_content(long asset, CCharPointer data, int len);

  @CFunction("parcel_asset_set_type")
  public static native void parcel_asset_set_type(long asset, CCharPointer data);

  @CFunction("parcel_free_buffer")
  public static native void parcel_free_buffer(Buffer buffer);

  public String getCode() {
    Buffer buffer = StackValue.get(Buffer.class);
    Asset.parcel_asset_get_content(buffer, this.asset);

    CCharPointer rawData = buffer.getData();
    String result = CTypeConversion.toJavaString(rawData, buffer.getLen());

    Asset.parcel_free_buffer(buffer);
    return result;
  }

  public void setCode(String code) {
    try (CTypeConversion.CCharPointerHolder holder = CTypeConversion.toCString(code)) {
      CCharPointer cPtr = holder.get();
      int length = code.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
      Asset.parcel_asset_set_content(this.asset, cPtr, length);
    }
  }

  public void setType(String type) {
    try (CTypeConversion.CCharPointerHolder holder = CTypeConversion.toCString(type)) {
      Asset.parcel_asset_set_type(this.asset, holder.get());
    }
  }
}

public final class Plugin {
  @CEntryPoint(name = "parcel_transform")
  public static void transform(IsolateThread thread, long assetPtr) {
    Asset asset = new Asset(assetPtr);
    String code = "module.exports = 'Hello from java: " + asset.getCode().toUpperCase() + "';";
    asset.setCode(code);
    asset.setType("js");
  }
}
