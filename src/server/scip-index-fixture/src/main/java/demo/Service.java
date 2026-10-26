package demo;

public class Service {
    private final Port port;
    private final Cache cache;
    private final MemberRepository members;

    public Service(Port port, Cache cache, MemberRepository members) {
        this.port = port;
        this.cache = cache;
        this.members = members;
    }

    public String 이름찾기(Long id) {
        String 기본값 = members.apply(id);
        String 표시 = "😀" + 기본값;
        return port.findById(id).orElse(표시) + cache.findById(id).orElse(기본값);
    }

    public String twice(Long id) {
        return 이름찾기(id) + 이름찾기(id + 1);
    }
}
